"""Runpod queue worker for the pinned Qwen Image 2.1 ComfyUI workflow.

Image bytes move directly between the worker and private Vercel Blob through
short-lived, single-object signed URLs. Runpod's result contains only paths.
"""

import io
import os
import re
import time
from pathlib import Path
from urllib.parse import urlsplit

import requests
import runpod
from PIL import Image
from PIL import ImageOps

Image.MAX_IMAGE_PIXELS = 40_000_000

COMFY = "http://127.0.0.1:8188"
MAX_INPUT_BYTES = 20 * 1024 * 1024
MAX_OUTPUT_BYTES = 100 * 1024 * 1024
WAIT_SECONDS = 1800
STARTUP_SECONDS = 300
NAME = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$")


def _blob_url(value, operation):
    if not isinstance(value, str):
        raise ValueError("Missing signed Blob URL")
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Invalid signed Blob URL")
    if operation == "get":
        if not parsed.hostname.endswith(".private.blob.vercel-storage.com"):
            raise ValueError("Reference URL must point to private Vercel Blob")
    elif not (
        (parsed.hostname == "vercel.com" and parsed.path == "/api/blob/")
        or parsed.hostname == "blob.vercel-storage.com"
        or parsed.hostname.endswith(".blob.vercel-storage.com")
    ):
        # Private Blob signed PUTs use Vercel's /api/blob/ control plane.
        raise ValueError("Output URL must point to Vercel Blob")
    return value


def _download_reference(name, url):
    if not NAME.fullmatch(name) or name in {".", ".."}:
        raise ValueError("Invalid reference filename")
    target = Path("/comfyui/input") / name
    total = 0
    with requests.get(_blob_url(url, "get"), stream=True, timeout=90) as response:
        response.raise_for_status()
        if int(response.headers.get("content-length", "0")) > MAX_INPUT_BYTES:
            raise ValueError("Reference image exceeds 20 MB")
        with target.open("wb") as output:
            for chunk in response.iter_content(1024 * 1024):
                total += len(chunk)
                if total > MAX_INPUT_BYTES:
                    raise ValueError("Reference image exceeds 20 MB")
                output.write(chunk)
    with Image.open(target) as source:
        image = ImageOps.exif_transpose(source)
        image.load()
    image.save(target, format="PNG")


def _upload(url, data, content_type):
    if len(data) > MAX_OUTPUT_BYTES:
        raise ValueError("Generated image exceeds the 100 MB output limit")
    response = requests.put(
        _blob_url(url, "put"), data=data,
        headers={"Content-Type": content_type}, timeout=180,
    )
    response.raise_for_status()


def _wait_for_comfy():
    deadline = time.monotonic() + STARTUP_SECONDS
    while time.monotonic() < deadline:
        try:
            response = requests.get(f"{COMFY}/system_stats", timeout=5)
            if response.ok:
                return
        except requests.RequestException:
            pass
        time.sleep(2)
    raise TimeoutError("ComfyUI did not become ready within 5 minutes")


def _wait_for_history(prompt_id):
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        response = requests.get(f"{COMFY}/history/{prompt_id}", timeout=20)
        response.raise_for_status()
        entry = response.json().get(prompt_id)
        if entry:
            return entry
        time.sleep(1)
    raise TimeoutError("ComfyUI did not finish within 30 minutes")


def handler(job):
    value = job.get("input") or {}
    studio_id = value.get("studioId")
    workflow = value.get("workflow")
    outputs = value.get("output") or {}
    if not isinstance(studio_id, str) or not re.fullmatch(r"[a-f0-9-]{36}", studio_id):
        return {"error": "Invalid studio image ID"}
    if not isinstance(workflow, dict) or not workflow:
        return {"error": "Missing ComfyUI workflow"}
    if not isinstance(outputs.get("image"), dict) or not isinstance(outputs.get("preview"), dict):
        return {"error": "Missing output upload URLs"}
    references = value.get("images") or []
    if not isinstance(references, list) or len(references) > 10:
        return {"error": "Use up to 10 reference images"}

    try:
        _wait_for_comfy()
        for reference in references:
            _download_reference(reference["name"], reference["url"])
        queued = requests.post(f"{COMFY}/prompt", json={"prompt": workflow}, timeout=30)
        if not queued.ok:
            raise ValueError(f"ComfyUI rejected the workflow: {queued.text[:700]}")
        prompt_id = queued.json()["prompt_id"]
        history = _wait_for_history(prompt_id)
        if history.get("status", {}).get("status_str") != "success":
            messages = history.get("status", {}).get("messages", [])
            error = next((m[1].get("exception_message") for m in messages if m[0] == "execution_error"), None)
            raise RuntimeError(str(error or "ComfyUI generation failed"))
        image_info = next(
            (image for node in history.get("outputs", {}).values() for image in node.get("images", []) if image.get("type") == "output"),
            None,
        )
        if not image_info:
            raise RuntimeError("ComfyUI did not save an output image")
        response = requests.get(f"{COMFY}/view", params={
            "filename": image_info["filename"],
            "subfolder": image_info.get("subfolder", ""), "type": "output",
        }, timeout=120)
        response.raise_for_status()
        original = response.content
        if len(original) > MAX_OUTPUT_BYTES:
            raise ValueError("Generated image exceeds the 100 MB output limit")
        with Image.open(io.BytesIO(original)) as image:
            width, height = image.size
            image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
            preview_buffer = io.BytesIO()
            image.convert("RGB").save(preview_buffer, "WEBP", quality=82, method=5)
            preview = preview_buffer.getvalue()
        _upload(outputs["image"]["putUrl"], original, "image/png")
        _upload(outputs["preview"]["putUrl"], preview, "image/webp")
        return {"studioId": studio_id, "images": [{
            "filename": image_info["filename"],
            "subfolder": image_info.get("subfolder", ""),
            "type": "output",
            "blobPath": outputs["image"]["path"],
            "previewPath": outputs["preview"]["path"],
            "width": width, "height": height, "bytes": len(original),
        }]}
    except Exception as exc:
        print(f"Qwen worker failed: {type(exc).__name__}: {exc}", flush=True)
        return {"error": str(exc)[:700], "studioId": studio_id}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})

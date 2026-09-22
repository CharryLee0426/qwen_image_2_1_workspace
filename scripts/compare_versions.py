#!/usr/bin/env python3
"""Generate the same scene from the archived v1.0 and v1.1 workflows."""

import json
from pathlib import Path
import shutil
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:8188"
DEST = ROOT / "ComfyUI/output/window_forest_comparison"
PROMPT = (
    "A realistic editorial photograph of a young woman sitting in a wooden chair "
    "in front of a large window. Beyond the window is a lush forest on a misty "
    "morning, with soft golden sunlight filtering through the trees. She sits "
    "in a relaxed three-quarter pose, looking out at the forest. Natural skin "
    "and fabric textures, believable hands, eye-level composition, gentle depth "
    "of field."
)


def get_json(path):
    with urllib.request.urlopen(URL + path, timeout=30) as response:
        return json.load(response)


def generate(version):
    source = ROOT / "workflows" / version
    graph = json.loads((source / "qwen-image-2.1-q4_k_m-api.json").read_text())
    workflow = json.loads((source / "qwen-image-2.1-q4_k_m.json").read_text())
    graph["452"]["inputs"]["prompt"] = PROMPT
    graph["458"]["inputs"]["seed"] = 42
    graph["456"]["inputs"].update(width=1024, height=1024)
    graph["461"]["inputs"]["filename_prefix"] = f"window_forest_{version}"
    for node in workflow["nodes"]:
        if node["id"] == 452:
            node["widgets_values"][0] = PROMPT
        elif node["id"] == 458:
            node["widgets_values"][0] = 42
        elif node["id"] == 461:
            node["widgets_values"][0] = f"window_forest_{version}"
    data = json.dumps({
        "prompt": graph,
        "extra_data": {"extra_pnginfo": {"workflow": workflow}},
    }).encode()
    request = urllib.request.Request(
        URL + "/prompt", data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        prompt_id = json.load(response)["prompt_id"]
    print(f"{version}: queued {prompt_id}", flush=True)
    started = time.monotonic()
    while time.monotonic() - started < 3600:
        entry = get_json("/history/" + prompt_id).get(prompt_id)
        if entry:
            (DEST / f"{version}-history.json").write_text(json.dumps(entry, indent=2) + "\n")
            if entry["status"]["status_str"] != "success":
                raise RuntimeError(json.dumps(entry["status"], indent=2))
            images = [img for out in entry["outputs"].values() for img in out.get("images", [])]
            if len(images) != 1:
                raise RuntimeError(f"Expected one image, found {len(images)}")
            img = images[0]
            path = ROOT / "ComfyUI/output" / img.get("subfolder", "") / img["filename"]
            target = DEST / f"{version}.png"
            shutil.copy2(path, target)
            print(f"{version}: saved {target} in {time.monotonic() - started:.1f}s", flush=True)
            return
        time.sleep(3)
    raise TimeoutError(f"{version}: job {prompt_id} still running")


if __name__ == "__main__":
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "prompt.txt").write_text(PROMPT + "\n")
    for version in ("v1.0", "v1.1"):
        generate(version)

#!/usr/bin/env python3
"""Run the installed Qwen Image 2.1 workflow through the local ComfyUI API."""
import argparse
import json
from pathlib import Path
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:8188"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prompt")
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=1024)
    parser.add_argument("--steps", type=int, default=40)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--negative-prompt", help="Override the v1.1 photo preset; pass an empty string to disable negative guidance")
    parser.add_argument("--prefix", default="Qwen_Image_2.1_Photo_v1.1")
    parser.add_argument("--timeout", type=int, default=3600)
    args = parser.parse_args()
    graph = json.loads((ROOT / "workflows/qwen-image-2.1-q4_k_m-api.json").read_text())
    graph["452"]["inputs"]["prompt"] = args.prompt
    if args.negative_prompt is not None:
        graph["452"]["inputs"]["negative_prompt"] = args.negative_prompt
    graph["456"]["inputs"].update(width=args.width, height=args.height)
    graph["458"]["inputs"].update(steps=args.steps, seed=args.seed, cfg=2 if graph["452"]["inputs"]["negative_prompt"].strip() else 1)
    graph["461"]["inputs"]["filename_prefix"] = args.prefix
    workflow = json.loads((ROOT / "workflows/qwen-image-2.1-q4_k_m.json").read_text())
    for node in workflow["nodes"]:
        if node["id"] == 452:
            node["widgets_values"][0] = args.prompt
            node["widgets_values"][1] = graph["452"]["inputs"]["negative_prompt"]
        elif node["id"] == 456:
            node["widgets_values"][:2] = [args.width, args.height]
        elif node["id"] == 458:
            node["widgets_values"][0] = args.seed
            node["widgets_values"][2] = args.steps
            node["widgets_values"][3] = graph["458"]["inputs"]["cfg"]
        elif node["id"] == 461:
            node["widgets_values"][0] = args.prefix
    request = urllib.request.Request(URL + "/prompt", data=json.dumps({
        "prompt": graph, "extra_data": {"extra_pnginfo": {"workflow": workflow}},
    }).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            submitted = json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(error.read().decode()) from error
    prompt_id = submitted["prompt_id"]
    print(f"Queued {prompt_id}", flush=True)
    started = time.monotonic()
    while time.monotonic() - started < args.timeout:
        with urllib.request.urlopen(URL + "/history/" + prompt_id, timeout=30) as response:
            entry = json.load(response).get(prompt_id)
        if entry:
            (ROOT / "logs" / f"generation-{prompt_id}.json").write_text(json.dumps(entry, indent=2) + "\n")
            if entry["status"]["status_str"] != "success":
                raise SystemExit(json.dumps(entry["status"], indent=2))
            for output in entry["outputs"].values():
                for image in output.get("images", []):
                    print(ROOT / "ComfyUI/output" / image.get("subfolder", "") / image["filename"])
            print(f"Completed in {time.monotonic() - started:.1f} seconds.")
            return
        time.sleep(2)
    raise SystemExit(f"Timed out waiting for {prompt_id}; job remains queued/running. Check {URL}.")


if __name__ == "__main__":
    main()

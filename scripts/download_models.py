#!/usr/bin/env python3
"""Download pinned model files and verify their published SHA-256 checksums."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import os

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parents[1]


def download(asset):
    target = ROOT / asset["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        print(f"Downloading {asset['file']}", flush=True)
        local_dir = target.parents[len(Path(asset["file"]).parts) - 1]
        hf_hub_download(asset["repository"], asset["file"],
                        revision=asset["revision"], local_dir=local_dir)
    candidate = target
    if candidate.stat().st_size != asset["size"]:
        raise RuntimeError(f"Incorrect size: {candidate}")
    with candidate.open("rb") as f:
        actual = hashlib.file_digest(f, "sha256").hexdigest()
    if actual != asset["sha256"]:
        raise RuntimeError(f"SHA-256 mismatch: {candidate}")
    print(f"Verified {target.name}: {actual}", flush=True)


if __name__ == "__main__":
    assets = json.loads((ROOT / "deployment/models.json").read_text())
    (ROOT / "logs").mkdir(exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(download, assets))

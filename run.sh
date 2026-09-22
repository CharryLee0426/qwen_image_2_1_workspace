#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/ComfyUI"
export PYTORCH_ENABLE_MPS_FALLBACK=1
export HF_HUB_DISABLE_TELEMETRY=1
exec "$PWD/../.venv/bin/python" "$PWD/main.py" --listen 127.0.0.1 --port 8188 \
  --disable-api-nodes --disable-auto-launch --use-pytorch-cross-attention \
  --bf16-unet --bf16-text-enc --cpu-vae "$@"

# Qwen Image 2.1 Q4_K_M — Image Studio

Open **http://127.0.0.1:3000** for the Next.js image studio. It supports positive and negative prompts, up to 10 reference images, live progress, cancellation, downloads, and a saved image library. See `webui/README.md` for frontend development and API details.

The underlying ComfyUI editor remains available at **http://127.0.0.1:8188**. Its Workflows sidebar includes **Qwen Image 2.1 Q4_K_M** and **Qwen Image 2.1 Q4_K_M - Reference**.

- Start both servers: double-click `start.command`, or run `./start.command` in this directory.
- Stop both servers: double-click `stop.command`, or run `./stop.command`.
- Frontend only: `./start-webui.command` / `./stop-webui.command`.
- Status: `.venv/bin/python scripts/service.py status`.
- Generated images: `ComfyUI/output/`.
- Server logs: `logs/comfyui.log` and `logs/webui.log`.
- Importable workflow: `workflows/qwen-image-2.1-q4_k_m.json`.

Both servers run in the background on localhost. Start them again after a reboot; they do not register login services.

Verified on this M4 Pro: all three SHA-256 checksums passed, and a 1024 × 1024 image at 25 Euler steps completed in 374.61 seconds. The saved workflow's Run button also passed, reusing cached inference. Example: `ComfyUI/output/Qwen_Image_2.1_Q4_K_M_00001.png`. Details are in `deployment/runtime.json`.

## Generate from the terminal

```sh
cd qwen_image_2_1_workspace
.venv/bin/python scripts/generate.py "A small red fox in a sunlit garden, watercolor illustration" --width 1024 --height 1024 --steps 25
```

The terminal script defaults to 1024 × 1024, 25 Euler steps, simple schedule, CFG 1, seed 42. Width and height should be multiples of 32. The generated PNG includes the workflow and generation parameters. The Next.js app automatically uses CFG 2 when a negative prompt is supplied, and CFG 1 otherwise. The saved ComfyUI workflows default to CFG 2 so negative prompts work there too. For more detail, increase steps toward 40–50; native 2048 × 2048 costs substantially more time and memory.

## Installed weights

| Component | File | Download size |
| --- | --- | --- |
| Diffusion model | `ComfyUI/models/diffusion_models/qwen-image-2.1-Q4_K_M.gguf` | 4.60 GB |
| Original BF16 text encoder, repackaged by Comfy | `ComfyUI/models/text_encoders/qwen3vl_8b_bf16.safetensors` | 17.53 GB |
| BF16 VAE, repackaged by Comfy | `ComfyUI/models/vae/qwen_image_2.1_vae_bf16.safetensors` | 0.68 GB |

Pinned revisions, exact sizes, and published SHA-256 values are in `deployment/models.json`. Run `.venv/bin/python scripts/download_models.py` to resume missing downloads and verify all checksums. Downloading requires internet; inference uses the local files.

The launcher uses Apple MPS for the diffusion model. ComfyUI's default shared-memory policy places the text encoder on CPU; the VAE is also explicitly on CPU. CPU VAE avoids the currently reported Apple MPS VAE-encoding corruption in image-edit workflows. Both text-to-image and reference-image editing are supplied.

## Compatibility and reproducibility

- ComfyUI commit: `e638023d54497dbe0579565e5de4bb7076899592`.
- ComfyUI-GGUF commit: `6ea2651e7df66d7585f6ffee804b20e92fb38b8a`.
- Python 3.12.13; exact installed packages are recorded in `deployment/requirements-lock.txt`.
- `deployment/comfyui-gguf-qwen21.patch` adds Qwen Image 2.1 detection for this metadata-free stable-diffusion.cpp GGUF. It does not alter weights. Preserve this patch when updating ComfyUI-GGUF until equivalent support is available upstream.
- `run.sh` contains all launch options. Optional paid API nodes are disabled.

## Sources

- [Requested GGUF model and installation instructions](https://huggingface.co/0xSojalSec/Qwen-Image-2.1-Uncensored-GGUF)
- [Original Qwen Image 2.1 model](https://huggingface.co/Qwen/Qwen-Image-2.1)
- [Comfy-packaged original text encoder and VAE](https://huggingface.co/Comfy-Org/Qwen-Image-2.1)
- [Official Comfy text-to-image workflow](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_t2i.json)
- [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF)
- [Apple MPS VAE issue and CPU workaround](https://github.com/Comfy-Org/ComfyUI/issues/16433)

The model is distributed under the Qwen Research License; see the upstream repository for its terms.

## Set up a fresh clone

This repository contains the studio, launchers, workflows, model manifest, and
compatibility patch. ComfyUI, Python/Node dependencies, downloaded weights,
generated images, and local runtime data are excluded from Git.

On macOS with Apple Silicon, install Python 3.12, Node.js (the original deployment
used 26.5.0), npm, and Git, then run from the repository root:

```sh
git clone https://github.com/Comfy-Org/ComfyUI.git ComfyUI
git -C ComfyUI checkout e638023d54497dbe0579565e5de4bb7076899592
git clone https://github.com/city96/ComfyUI-GGUF.git ComfyUI/custom_nodes/ComfyUI-GGUF
git -C ComfyUI/custom_nodes/ComfyUI-GGUF checkout 6ea2651e7df66d7585f6ffee804b20e92fb38b8a
git -C ComfyUI/custom_nodes/ComfyUI-GGUF apply ../../../deployment/comfyui-gguf-qwen21.patch
python3.12 -m venv .venv
.venv/bin/python -m pip install -r deployment/requirements-lock.txt
.venv/bin/python scripts/download_models.py
mkdir -p logs ComfyUI/user/default/workflows
cp workflows/qwen-image-2.1-q4_k_m.json workflows/qwen-image-2.1-q4_k_m-reference.json ComfyUI/user/default/workflows/
npm --prefix webui ci
npm --prefix webui run build
```

Before starting on another machine, update the absolute Node executable path in
`run-webui.sh` to the output of `command -v node`. Then run `./start.command`.
The exact dependency lock records the original macOS deployment; setup on other
platforms has not been verified. Model downloads require approximately 23 GB of
storage in addition to the application dependencies.

# Photographic workflow research and v1.1 design

## Evidence

- [Qwen's Qwen-Image 2.1 model card](https://huggingface.co/Qwen/Qwen-Image-2.1) shows 40 inference steps in its text-to-image example and supports direct 2048 × 2048 output and image editing with up to ten references.
- [Diffusers' Qwen-Image 2.1 documentation](https://huggingface.co/docs/diffusers/main/api/pipelines/qwenimage21) says the recommended default is 40 steps with no guidance. A negative prompt only affects sampling with `true_cfg_scale > 1` and roughly doubles denoising work per step.
- [ComfyUI's official Qwen Image 2.1 template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_t2i.json) uses Euler with a simple schedule and says 40–50 steps is the official quality range. Its 25-step default is a faster starting point, and it confirms the negative field is inactive at CFG 1.
- [Qwen's prompt-expansion guidance](https://huggingface.co/Qwen/Qwen-Image-2.1-PE-T2I/blob/main/system_prompt.txt) recommends naming the photographic medium, subject and setting, then describing the visible composition and light. It advises against generic boosters such as “masterpiece” and “8K”.

## v1.1 decisions

The photo workflow keeps the installed Q4_K_M model, BF16 text encoder and VAE, `TextEncodeQwenImage21`, Euler/simple sampling, and PNG output. The standalone ComfyUI graph now opens with a concrete editorial photograph prompt and the negative preset below. It uses 40 steps at 1024 × 1024 and CFG 2. The Web UI uses 20 steps at 512 for Fast, 40 at 1024 for Standard, and 40 at 2048 for High. Dimensions stay multiples of 32; reference generation retains the first image's aspect ratio.

CFG 2 is a conservative local choice to make the requested negative preset operative. It is **not** a Qwen recommended optimum; the official default is CFG 1 without negative guidance. A user who clears the negative prompt after unlocking it returns to CFG 1. The negative prompt and CFG 2 can change composition and increase inference time, so compare results at the same seed when tuning photographic output.

The default negative prompt is organized by failure type and avoids broad bans on blur, shadow, grain, or depth of field, which can be legitimate photographic details:

```text
Non-photographic media: illustration, painting, drawing, cartoon, anime, 3D render, CGI.
Artificial finish: plastic or waxy surfaces, over-smoothed skin, excessive HDR, sharpening halos, unnatural saturation.
Generation defects: distorted anatomy, extra or fused fingers, duplicated limbs, repeated objects, warped geometry, banding, compression artifacts.
Unwanted overlays: watermark, logo, border, frame, unintended text.
```

For a realistic result, the positive prompt should describe the desired photograph rather than rely on the negative prompt alone: subject, setting, framing or camera perspective, light source and direction, natural material textures, and any intentional focus falloff. The Web UI gives this cue as a placeholder and helper text without rewriting the user's prompt.

## Versions and operation

- `workflows/v1.0/`: exact copies of the prior text-to-image, reference, and API JSON files.
- `workflows/v1.1/`: immutable copies of the new versions. The same v1.1 files at the top of `workflows/` are the live defaults used by the launcher and CLI.
- The Web UI starts with the preset locked. Unlock allows editing; Lock protects the current text; Reset restores the preset and locks it. Existing v1.0 drafts adopt the new negative preset once; v1.1 edits persist across refreshes.
- The CLI uses the same preset and 40 steps. `--negative-prompt ''` disables negative guidance and sets CFG 1.

This design is based on the model and workflow documentation. The preset wording and CFG 2 need visual comparison on the local Q4 model to establish any improvement for a particular subject; no universal photorealism score is claimed.

A local 512 × 512, 20-step, CFG 2 smoke run completed in 227 seconds and produced a photographic fox image. This confirms the graph executes; it does not establish that the preset beats Qwen's CFG 1 baseline across subjects.

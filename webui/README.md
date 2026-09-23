# Qwen Image Studio

Next.js 16.3.5, React 19.3, TypeScript. Local production UI: http://127.0.0.1:3000. ComfyUI engine: http://127.0.0.1:8188.

## Run

From the workspace root, `./start.command` starts both servers and `./stop.command` stops both. `./start-webui.command` and `./stop-webui.command` manage only Next.js. Logs: `../logs/webui.log`.

```sh
npm ci
npm run build
npm start
```

For development, stop the production frontend first, then `npm run dev`. `COMFY_URL` can override the engine address. The UI and engine bind to localhost.

## Behavior

- A photo-oriented positive prompt cue and a predefined negative prompt. The negative prompt starts locked; unlock it to edit, lock it again to protect an edit, or use Reset to restore the photo preset and lock it.
- A nonempty negative prompt activates CFG 2; otherwise CFG 1 follows Qwen's default path. The negative branch is connected in both modes.
- Up to 10 PNG, JPEG, or WebP reference images, each up to 20 MB. Uploaded files are decoded, orientation-corrected, and stored as PNGs in ComfyUI's `input/qwen-studio/` directory.
- Reference mode connects both the VAE and vision inputs to `TextEncodeQwenImage21`. The first reference determines the output aspect ratio; all references retain their upload order.
- Fast: 512-pixel target, 20 steps. Standard: 1024, 40 steps. High: 2048, 40 steps. In reference mode, resolution is a square pixel budget, with the source aspect ratio preserved.
- Actual sampling progress comes from ComfyUI's WebSocket. Job completion comes from its history API. Cancelling uses the specific prompt ID and never globally interrupts another workflow.
- Generation records persist in `.data/jobs/`. Images remain in `../ComfyUI/output/QwenStudio/`. Draft prompts/settings persist in browser storage. Active generations and their references recover after refresh.
- The library contains actual local generations, including the original verified installation image. There are no mock outputs or external image services.

## Verify

```sh
npm run typecheck
npm test
npm run build
```

The workflow tests cover negative guidance, ordered multiple reference conditioning, reference-derived latents, aspect ratio, and invalid inputs. The origin test covers Next's normalized URL behavior and rejection of foreign origins. Live inference and cancellation evidence is saved in the workspace's `deployment/webui-*-test*.json` files.

## Hosted deployment

The Vercel deployment uses `RUNPOD_ENDPOINT_ID`, `RUNPOD_API_KEY`, `STUDIO_PASSWORD`, `RUNPOD_WEBHOOK_SECRET`, `PUBLIC_BASE_URL`, and a project-connected private Vercel Blob store (`BLOB_STORE_ID` and Vercel's Blob credentials). The shared studio password is stored as a Vercel secret and creates a secure, HTTP-only session cookie. Keep the Runpod API key and studio password out of Git.

Hosted reference images upload from the browser straight to private Blob with a short-lived, single-file signed URL. The Runpod worker downloads them and uploads a full PNG plus a 1024-pixel WebP preview straight to Blob. Job status and image paths stay in a small private Blob index. The studio displays previews in its grid and fetches the original only for a full view or download. This keeps large images out of Vercel Function request and response bodies and out of Runpod's JSON results.

Each reference image is limited to 20 MB and each generated PNG to 100 MB. The worker enforces these limits as well as the UI and signed upload tokens. A larger-than-100-MB output needs a multipart upload implementation before increasing that limit. The hosted library retains the newest 100 job records; image files stay in Blob until explicitly removed.

The worker image and exact model revisions are in `../runpod/`. The endpoint should use NVIDIA GeForce RTX 5090, zero minimum workers, two maximum workers, and one concurrent request per worker. Cold starts and real image generation time must be measured on the deployed GPU; the requested five-second average is a planning assumption, not a verified Qwen Image 2.1 runtime.

## API

- `POST /api/generate`: multipart `settings` JSON plus zero to ten `images` files. Settings: `prompt`, `negativePrompt`, `width`, `height`, `steps`, `seed`, `resolution`.
- `GET /api/jobs`: saved library and job records.
- `GET /api/jobs/:id`: current engine status and output image references.
- `DELETE /api/jobs/:id`: cancel that job.
- `GET /api/image?filename=…&subfolder=…&type=output`: image stream; add `download=1` for a download.
- `GET /api/health`: engine connectivity.

# Runpod Serverless worker

Build `Dockerfile` from the repository root. It starts from Runpod's ComfyUI worker base, installs the exact ComfyUI and ComfyUI-GGUF revisions used by the local verified workflow, applies the Qwen 2.1 compatibility patch, downloads the three pinned model files, and verifies their SHA-256 hashes. The resulting image contains about 23 GB of model weights. No API key or user image is baked into it.

`handler.py` receives a ComfyUI workflow, fetches up to 10 reference images through private Blob signed URLs, waits for ComfyUI, and uploads the original PNG and a WebP preview to private Blob. It returns only image paths and metadata. The Vercel application supplies short-lived signed URLs for each job and handles job status, authentication, and the image library.

The intended endpoint uses the exact `NVIDIA GeForce RTX 5090` GPU (32 GB), one request per worker, zero minimum workers, and two maximum workers. The model has not been benchmarked on this GPU; the five-second average in capacity planning should be replaced by measured execution time. At $1.58 per GPU hour, 1,000 jobs per day at exactly five seconds of billable GPU time would cost approximately $2.19 per day before cold starts, storage, and other charges.

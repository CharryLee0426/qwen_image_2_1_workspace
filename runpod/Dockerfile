FROM runpod/worker-comfyui:5.10.0-base

# Keep the same ComfyUI and GGUF revisions as the verified local workflow.
RUN rm -rf /comfyui \
    && git clone --filter=blob:none https://github.com/Comfy-Org/ComfyUI.git /comfyui \
    && git -C /comfyui checkout e638023d54497dbe0579565e5de4bb7076899592 \
    && uv pip install -r /comfyui/requirements.txt \
    && uv pip install 'transformers>=4.50.3,<5' 'huggingface-hub<1.0'

RUN git clone --filter=blob:none https://github.com/city96/ComfyUI-GGUF.git /comfyui/custom_nodes/ComfyUI-GGUF \
    && git -C /comfyui/custom_nodes/ComfyUI-GGUF checkout 6ea2651e7df66d7585f6ffee804b20e92fb38b8a
COPY deployment/comfyui-gguf-qwen21.patch /tmp/comfyui-gguf-qwen21.patch
RUN git -C /comfyui/custom_nodes/ComfyUI-GGUF apply /tmp/comfyui-gguf-qwen21.patch \
    && uv pip install -r /comfyui/custom_nodes/ComfyUI-GGUF/requirements.txt \
    && python /comfyui/main.py --quick-test-for-ci --cpu

# Downloads are pinned and checked. Model weights stay out of Git and Docker's build context.
RUN mkdir -p /comfyui/models/diffusion_models /comfyui/models/text_encoders /comfyui/models/vae \
    && wget -q --tries=5 -O /comfyui/models/diffusion_models/qwen-image-2.1-Q4_K_M.gguf \
      https://huggingface.co/0xSojalSec/Qwen-Image-2.1-Uncensored-GGUF/resolve/242be4d1f70cc26fa45773c452f81980ed656e2e/qwen-image-2.1-Q4_K_M.gguf \
    && echo '833439e91bc1152d28f37aa198c7f6f4218b7de95754c2f7a318a2422ab4b2f8  /comfyui/models/diffusion_models/qwen-image-2.1-Q4_K_M.gguf' | sha256sum -c -

RUN wget -q --tries=5 -O /comfyui/models/text_encoders/qwen3vl_8b_bf16.safetensors \
      https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/ace0edeb3791a594ddfa36ed5f41a178a394e921/text_encoders/qwen3vl_8b_bf16.safetensors \
    && echo '68bdc82bc1b66851162ae656225e7e2068166b603db19bd5d5a3b90eb12669a9  /comfyui/models/text_encoders/qwen3vl_8b_bf16.safetensors' | sha256sum -c -

RUN wget -q --tries=5 -O /comfyui/models/vae/qwen_image_2.1_vae_bf16.safetensors \
      https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/ace0edeb3791a594ddfa36ed5f41a178a394e921/vae/qwen_image_2.1_vae_bf16.safetensors \
    && echo 'bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9  /comfyui/models/vae/qwen_image_2.1_vae_bf16.safetensors' | sha256sum -c -

COPY runpod/handler.py /handler.py
CMD ["/start.sh"]

@echo off
cd /d "f:\Downloads\role_new"
echo Renaming VAE...
move /y "WebUI_Forge_cu121_torch231\webui\models\VAE\chroma-ae.safetensors" "WebUI_Forge_cu121_torch231\webui\models\VAE\ae.safetensors"
echo Downloading CLIP-L...
curl -L -o "WebUI_Forge_cu121_torch231\webui\models\text_encoder\clip_l.safetensors" "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors"
echo Done.

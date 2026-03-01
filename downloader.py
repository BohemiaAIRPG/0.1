import os
import urllib.request
import sys

def run():
    # 1. Rename VAE
    src = r"WebUI_Forge_cu121_torch231\webui\models\VAE\chroma-ae.safetensors"
    dst = r"WebUI_Forge_cu121_torch231\webui\models\VAE\ae.safetensors"
    if os.path.exists(src):
        try:
            os.rename(src, dst)
            print("SUCCESS: VAE renamed")
        except Exception as e:
            print(f"FAILED: VAE rename: {e}")
    elif os.path.exists(dst):
        print("INFO: VAE already renamed")
    
    # 2. Download CLIP-L
    url = "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors"
    out = r"WebUI_Forge_cu121_torch231\webui\models\text_encoder\clip_l.safetensors"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    
    if not os.path.exists(out):
        print("INFO: Starting CLIP-L download...")
        try:
            urllib.request.urlretrieve(url, out)
            print("SUCCESS: CLIP-L downloaded")
        except Exception as e:
            print(f"FAILED: CLIP-L download: {e}")
    else:
        print("INFO: CLIP-L already exists")

if __name__ == "__main__":
    run()

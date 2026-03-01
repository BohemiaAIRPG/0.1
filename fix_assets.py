import os
import urllib.request
import sys

def main():
    # Paths are relative to f:\Downloads\role_new
    vae_old = r"WebUI_Forge_cu121_torch231\webui\models\VAE\chroma-ae.safetensors"
    vae_new = r"WebUI_Forge_cu121_torch231\webui\models\VAE\ae.safetensors"
    
    # 1. Rename VAE
    if os.path.exists(vae_old):
        try:
            os.rename(vae_old, vae_new)
            print("DONE: VAE renamed")
        except Exception as e:
            print(f"ERR: VAE rename: {e}")
    elif os.path.exists(vae_new):
        print("INFO: VAE already renamed")
    else:
        print("ERR: VAE source not found")

    # 2. Download CLIP-L
    clip_url = "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors"
    clip_dest = r"WebUI_Forge_cu121_torch231\webui\models\text_encoder\clip_l.safetensors"
    
    os.makedirs(os.path.dirname(clip_dest), exist_ok=True)
    
    if not os.path.exists(clip_dest):
        print("START: Downloading CLIP-L (~160MB)...")
        try:
            urllib.request.urlretrieve(clip_url, clip_dest)
            print("DONE: CLIP-L downloaded")
        except Exception as e:
            print(f"ERR: CLIP-L download: {e}")
    else:
        print("INFO: CLIP-L already exists")

if __name__ == "__main__":
    main()

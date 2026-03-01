import urllib.request
import os
import sys
import time

FILES = [
    {
        "url": "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors",
        "dest": r"WebUI_Forge_cu121_torch231\webui\models\text_encoder\clip_l.safetensors",
        "name": "CLIP-L (160 MB)"
    }
]

def download(url, dest, label):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest):
        print(f"{label} already exists at {dest}")
        return
    print(f"\nDownloading {label}...")
    req = urllib.request.Request(url, headers={"User-Agent": "python-wget"})
    start_time = time.time()
    try:
        with urllib.request.urlopen(req) as response, open(dest, 'wb') as out_file:
            total_size = int(response.headers.get("content-length", 0))
            downloaded = 0
            block_size = 1024 * 1024
            while True:
                chunk = response.read(block_size)
                if not chunk: break
                out_file.write(chunk)
                downloaded += len(chunk)
                elapsed = time.time() - start_time
                speed = downloaded / (1024 * 1024 * elapsed) if elapsed > 0 else 0
                percent = int(downloaded * 100 / total_size) if total_size > 0 else 0
                sys.stdout.write(f"\r  {percent}% | {downloaded / (1024*1024):.0f} MB / {total_size / (1024*1024):.0f} MB | {speed:.1f} MB/s")
                sys.stdout.flush()
        print(f"\n  Done: {label}")
    except Exception as e:
        print(f"\n  ERROR downloading {label}: {e}")

for f in FILES:
    download(f["url"], f["dest"], f["name"])

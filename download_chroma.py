import urllib.request
import sys
import time
import os

# Только основная модель — T5XXL и VAE уже скачались раньше
FILES = [
    {
        "url": "https://huggingface.co/QuantStack/Chroma1-Flash-GGUF/resolve/main/Chroma1-HD-Flash-Q4_K_S.gguf",
        "dest": r"WebUI_Forge_cu121_torch231\webui\models\unet\chroma-flash-Q4_K_S.gguf",
        "name": "Chroma1-HD-Flash GGUF Q4 model (~5 GB)"
    }
]

def download(url, dest, label):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
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
                if not chunk:
                    break
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

print("======================================================")
print("  Chroma GGUF model download (T5XXL + VAE already done)")
print("======================================================")

for f in FILES:
    download(f["url"], f["dest"], f["name"])

print("\nDone! Now:")
print("1. Close Forge if running")
print("2. Reopen run.bat")
print("3. Wait until Forge starts, then try the game")

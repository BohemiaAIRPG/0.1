import os
import struct

def get_keys(path):
    if not os.path.exists(path): return "NOT_FOUND"
    try:
        with open(path, "rb") as f:
            header_len_bytes = f.read(8)
            header_len = struct.unpack("<Q", header_len_bytes)[0]
            header = f.read(header_len).decode("utf-8")
            # header is JSON, but we just need keys
            import json
            data = json.loads(header)
            return list(data.keys())[:5]
    except Exception as e:
        return f"ERROR:{e}"

repo_path = r"f:\Downloads\role_new\WebUI_Forge_cu121_torch231\webui\models"
results = []

results.append("--- VAE Keys ---")
results.append(str(get_keys(os.path.join(repo_path, "VAE", "chroma-ae.safetensors"))))

results.append("\n--- UNET Keys ---")
# GGUF is different, but let's see if we can get anything
results.append("GGUF detected")

results.append("\n--- Files Listing ---")
for root, dirs, files in os.walk(repo_path):
    for f in files:
        if f.endswith(".safetensors") or f.endswith(".gguf"):
            results.append(os.path.join(root, f))

with open(r"f:\Downloads\role_new\diagnostic_result.txt", "w") as f:
    f.write("\n".join(results))

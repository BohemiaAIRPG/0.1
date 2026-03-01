import os
path = r"f:\Downloads\role_new\WebUI_Forge_cu121_torch231\webui\models\VAE\chroma-ae.safetensors"
try:
    with open(path, "rb") as f:
        header_len_bytes = f.read(8)
        import struct
        header_len = struct.unpack("<Q", header_len_bytes)[0]
        header = f.read(header_len).decode("utf-8")
        print(f"HEADER_START:{header[:500]}")
except Exception as e:
    print(f"ERR:{e}")

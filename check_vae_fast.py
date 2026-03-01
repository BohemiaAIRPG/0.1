from safetensors import safe_open
import os

path = r"f:\Downloads\role_new\WebUI_Forge_cu121_torch231\webui\models\VAE\chroma-ae.safetensors"
result_path = r"f:\Downloads\role_new\vae_result.txt"

try:
    if os.path.exists(path):
        with safe_open(path, framework="pt") as f:
            keys = list(f.keys())
            with open(result_path, "w") as rf:
                rf.write(f"TOTAL:{len(keys)}\n")
                if keys:
                    rf.write(f"FIRST:{keys[0]}\n")
                else:
                    rf.write("EMPTY\n")
    else:
        with open(result_path, "w") as rf:
            rf.write("NOTFOUND\n")
except Exception as e:
    with open(result_path, "w") as rf:
        rf.write(f"ERROR:{e}\n")

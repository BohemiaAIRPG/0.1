from safetensors import safe_open
import os

path = r"f:\Downloads\role_new\WebUI_Forge_cu121_torch231\webui\models\VAE\chroma-ae.safetensors"
if os.path.exists(path):
    try:
        with safe_open(path, framework="pt") as f:
            keys = list(f.keys())
            print(f"Total keys: {len(keys)}")
            print("First 20 keys:")
            for k in keys[:20]:
                print(k)
            
            # Check for common VAE keys
            test_keys = ["decoder.conv_in.weight", "vae.decoder.conv_in.weight", "conv_in.weight"]
            for tk in test_keys:
                if tk in keys:
                    print(f"Found key: {tk}")
    except Exception as e:
        print(f"Error: {e}")
else:
    print("File not found")

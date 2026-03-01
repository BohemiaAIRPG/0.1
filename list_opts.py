import urllib.request
import json
import sys

try:
    req = urllib.request.Request("http://127.0.0.1:7860/sdapi/v1/options")
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        
        # Check specific keywords related to the Forge GPU Weights UI slider
        keys = []
        for k in data.keys():
            k_lower = k.lower()
            if 'forge' in k_lower or 'weight' in k_lower or 'gpu' in k_lower or 'mem' in k_lower or 'vram' in k_lower:
                keys.append(k)
        
        with open('forge_options_dump.json', 'w') as f:
            json.dump({k: data[k] for k in keys}, f, indent=2)
            
        print("Success! Dumped options to forge_options_dump.json")
except Exception as e:
    print(f"Error: {e}")

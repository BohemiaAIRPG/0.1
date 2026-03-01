import urllib.request
import json

req = urllib.request.Request("http://127.0.0.1:7860/sdapi/v1/options")
with urllib.request.urlopen(req) as response:
    data = json.loads(response.read().decode())
    gpu_keys = [k for k in data.keys() if 'gpu' in k.lower() or 'weight' in k.lower() or 'memory' in k.lower() or 'forge' in k.lower()]
    for k in gpu_keys:
        print(f"{k}: {data[k]}")

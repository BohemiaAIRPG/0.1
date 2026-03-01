import urllib.request, json
try:
    with urllib.request.urlopen("http://127.0.0.1:7860/sdapi/v1/sd-models") as r:
        models = json.loads(r.read())
        print(json.dumps(models, indent=2))
except Exception as e:
    print("Error:", e)

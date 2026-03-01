import urllib.request, json
req = urllib.request.Request("http://127.0.0.1:7860/sdapi/v1/refresh-checkpoints", method="POST")
req.add_header("Content-Type", "application/json")
try:
    with urllib.request.urlopen(req) as r:
        print("Refreshed:", r.status)
except Exception as e:
    print("Error:", e)

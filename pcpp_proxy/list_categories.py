import json
from pcpartpicker import API

REGION = "us"  # or "be"
api = API(REGION)

data = api.retrieve_all()          # PartData
json_text = data.to_json()         # string
obj = json.loads(json_text)        # dict

print("Supported categories:")
for k in obj.keys():
    print("-", k)

# Also print a ready-to-paste JS array for your Node ALLOWED list
cats = list(obj.keys())
print("\nJS ALLOWED array:")
print("[")
for i, c in enumerate(cats):
    comma = "," if i < len(cats) - 1 else ""
    print(f'  "{c}"{comma}')
print("]")

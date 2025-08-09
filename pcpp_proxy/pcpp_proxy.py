import os
import traceback
import asyncio
import json
from fastapi import FastAPI, Query, HTTPException
from pcpartpicker import API

DEFAULT_REGION = os.getenv("PCPP_REGION", "be")
app = FastAPI(title="PCPartPicker Proxy")
pcpp = API(DEFAULT_REGION)

def _ensure_loop():
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

def _retrieve_all(region: str | None):
    _ensure_loop()
    if region:
        pcpp.set_region(region)
    return pcpp.retrieve_all()

def _retrieve_category(category: str, region: str | None):
    _ensure_loop()
    if region:
        pcpp.set_region(region)
    return pcpp.retrieve(category)

@app.get("/health")
def health():
    return {"ok": True, "region": DEFAULT_REGION}

@app.get("/parts-all")
async def parts_all(region: str | None = Query(None)):
    try:
        data = await asyncio.to_thread(_retrieve_all, region)
        # to_json() returns a STRING -> parse it to dict
        obj = json.loads(data.to_json())
        return {"timestamp": data.timestamp.isoformat(), "data": obj}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=str(e))

@app.get("/parts/{category}")
async def parts_category(category: str, region: str | None = Query(None)):
    try:
        data = await asyncio.to_thread(_retrieve_category, category, region)
        obj = json.loads(data.to_json())
        # For single category, return the ARRAY directly so Node gets an array
        # obj may be {"cpu":[...]} or similar
        arr = obj.get(category) or obj.get(category.lower()) or []
        return {"timestamp": data.timestamp.isoformat(), "data": arr}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=str(e))

from typing import Optional
import os
import traceback
import asyncio
import json
from fastapi import FastAPI, Query, HTTPException
from pcpartpicker import API
import concurrent.futures
executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)

DEFAULT_REGION = os.getenv("PCPP_REGION", "be")
app = FastAPI(title="PCPartPicker Proxy")
pcpp = API(DEFAULT_REGION)

def _ensure_loop():
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

def _retrieve_all(region: Optional[str]):
    _ensure_loop()
    if region:
        pcpp.set_region(region)
    return pcpp.retrieve_all()

def _retrieve_category(category: str, region: Optional[str]):
    _ensure_loop()
    if region:
        pcpp.set_region(region)
    return pcpp.retrieve(category)

@app.get("/health")
def health():
    return {"ok": True, "region": DEFAULT_REGION}

@app.get("/parts-all")
async def parts_all(region: Optional[str] = Query(None)):
    try:
        loop = asyncio.get_running_loop()
        data = await asyncio.wait_for(
            loop.run_in_executor(executor, _retrieve_all, region),
            timeout=15  # seconds
        )
        obj = json.loads(data.to_json())
        return {"timestamp": data.timestamp.isoformat(), "data": obj}
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Fetch timed out")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=str(e))

@app.get("/parts/{category}")
async def parts_category(category: str, region: Optional[str] = Query(None)):
    try:
        loop = asyncio.get_running_loop()
        data = await asyncio.wait_for(
            loop.run_in_executor(executor, _retrieve_category, category, region),
            timeout=10  # seconds
        )
        obj = json.loads(data.to_json())
        arr = obj.get(category) or obj.get(category.lower()) or []
        return {"timestamp": data.timestamp.isoformat(), "data": arr}
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Fetch timed out")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=str(e))

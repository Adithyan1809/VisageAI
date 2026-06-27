import os
from fastapi import APIRouter
import requests
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()
ONVIF_URL = os.getenv("ONVIF_URL", "http://localhost:5001")


@router.get("/discover")
def discover():
    return requests.get(f"{ONVIF_URL}/discover").json()


@router.post("/validate")
def validate(payload: dict):
    return requests.post(f"{ONVIF_URL}/validate", json=payload).json()

#!/usr/bin/env python3
"""
ONVIF Discovery + Validation Service (integrated with main_pipeline)

Endpoints:
- GET  /discover
- GET  /discover/results
- POST /validate_camera
- POST /set_credentials
- GET  /health
"""

import os
import time
import socket
import traceback
from urllib.parse import urlparse
from flask import Flask, jsonify, request
import requests
from wsdiscovery import WSDiscovery
from onvif import ONVIFCamera
import logging
logging.basicConfig(level=logging.DEBUG)

# Config (make configurable via env)
PIPELINE_API_URL = os.environ.get("PIPELINE_API_URL", "http://localhost:8081/cameras")
ONVIF_PORTS_TO_TRY = [80, 8080, 8899]
WSDISCOVERY_TIMEOUT = float(os.environ.get("WSDISCOVERY_TIMEOUT", 4.0))
HTTP_CHECK_TIMEOUT = float(os.environ.get("HTTP_CHECK_TIMEOUT", 1.2))
DIRECT_SCAN_PREFIXES = os.environ.get("DIRECT_SCAN_PREFIXES", "192.168.1.,192.168.0.,10.0.0.,10.245.107.").split(",")

MAX_DIRECT_SCAN = int(os.environ.get("MAX_DIRECT_SCAN", 120))

app = Flask(__name__)

state = {
    "last_discovered": [],
    "last_discovered_at": None,
    "shared_username": None,
    "shared_password": None,
}


# ---------------- Utils ----------------
def safe_print_exc(prefix=""):
    print(prefix)
    traceback.print_exc()


def inject_credentials_into_rtsp(rtsp_uri, username, password):
    if not rtsp_uri:
        return rtsp_uri
    parsed = urlparse(rtsp_uri)
    if parsed.username:  # already has auth
        return rtsp_uri
    if rtsp_uri.startswith("rtsp://"):
        return rtsp_uri.replace("rtsp://", f"rtsp://{username}:{password}@")
    return rtsp_uri


def post_to_pipeline(camera_payload, retries=3, delay=2):
    for attempt in range(1, retries + 1):
        try:
            resp = requests.post(PIPELINE_API_URL, json=camera_payload, timeout=5)
            # Accept any 2xx as success
            if 200 <= resp.status_code < 300:
                print(f"[PIPELINE] ✅ Camera {camera_payload.get('camera_id')} activated successfully ({resp.status_code})")
                return True, f"{resp.status_code}: {resp.text}"
            else:
                print(f"[PIPELINE] ⚠ Attempt {attempt}: {resp.status_code} {resp.text}")
        except Exception as e:
            print(f"[PIPELINE] ❌ Attempt {attempt}: {e}")
        time.sleep(delay)
    return False, f"Failed after {retries} retries"


def quick_tcp_check(ip, port, timeout=0.3):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect((ip, port))
            return True
    except Exception:
        return False


# ---------------- ONVIF helpers ----------------
def try_onvif_connect(ip, username, password, preferred_ports=None):
    last_err = None
    port_list = (preferred_ports or []) + ONVIF_PORTS_TO_TRY
    seen = set()

    for port in port_list:
        if port in seen or port is None:
            continue
        seen.add(port)
        url = f"http://{ip}:{port}/onvif/device_service"
        try:
            r = requests.get(url, timeout=HTTP_CHECK_TIMEOUT)
            if r.status_code not in (200, 401, 403, 405):
                last_err = f"HTTP {r.status_code} at {url}"
                continue
        except Exception as e:
            last_err = f"HTTP check failed {url}: {e}"

        try:
            cam = ONVIFCamera(ip, port, username, password, timeout=5)
            media = cam.create_media_service()
            profiles = media.GetProfiles()
            print(f"[ONVIF] ✅ Connected to {ip}:{port}, {len(profiles)} profiles")
            return {"success": True, "ip": ip, "port": port, "cam": cam, "profiles": profiles, "error": None}
        except Exception as e:
            last_err = f"ONVIF init failed {ip}:{port} -> {e}"
            continue

    print(f"[ONVIF] ❌ Connection failed for {ip} -> {last_err}")
    return {"success": False, "ip": ip, "port": None, "cam": None, "profiles": None, "error": last_err}


# ---------------- Discovery ----------------
def ws_discovery_list(timeout=WSDISCOVERY_TIMEOUT):
    results = []
    wsd = None
    try:
        wsd = WSDiscovery()
        wsd.start()
        services = wsd.searchServices(timeout=timeout)
    except Exception:
        safe_print_exc("[WS-Discovery] error:")
        services = []
    finally:
        if wsd is not None:
            try:
                wsd.stop()
            except Exception:
                pass

    for s in services:
        xaddrs = s.getXAddrs()
        if not xaddrs:
            continue
        for addr in xaddrs:
            try:
                parsed = urlparse(addr)
                ip = parsed.hostname
                port = parsed.port or 80
                if ip:
                    results.append({"ip": ip, "port": port, "source": "wsdiscovery", "xaddr": addr})
            except Exception:
                continue
    return results


def direct_ip_fallback_scan(limit=MAX_DIRECT_SCAN):
    results = []
    scanned = 0
    for prefix in DIRECT_SCAN_PREFIXES:
        prefix = prefix.strip()
        if not prefix:
            continue
        for i in range(1, 255):
            if scanned >= limit:
                break
            ip = f"{prefix}{i}"
            scanned += 1
            alive = any(quick_tcp_check(ip, p, timeout=0.18) for p in ONVIF_PORTS_TO_TRY)
            if alive:
                results.append({"ip": ip, "port": None, "source": "direct-scan"})
        if scanned >= limit:
            break
    return results


@app.route("/discover", methods=["GET"])
def discover():
    try:
        ws = ws_discovery_list()
        discovered = []
        seen = set()
        for item in ws:
            ip = item.get("ip")
            if ip and ip not in seen:
                seen.add(ip)
                discovered.append({"ip": ip, "port": item.get("port"), "source": item.get("source")})

        if len(discovered) < 1:
            fallback = direct_ip_fallback_scan()
            for item in fallback:
                ip = item.get("ip")
                if ip and ip not in seen:
                    seen.add(ip)
                    discovered.append(item)

        state["last_discovered"] = discovered
        state["last_discovered_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
        print(f"[DISCOVERY] Found {len(discovered)} cameras")
        print("Discovered list:", discovered)

        return jsonify({"message": "discovery complete", "count": len(discovered), "devices": discovered}), 200
    except Exception as e:
        safe_print_exc("[discover] error")
        return jsonify({"message": "discovery failed", "error": str(e)}), 500


@app.route("/discover/results", methods=["GET"])
def discover_results():
    return jsonify({
        "last_discovered_at": state.get("last_discovered_at"),
        "devices": state.get("last_discovered", [])
    }), 200


# ---------------- Validation & Activation ----------------
@app.route("/validate_camera", methods=["POST"])
def validate_camera():
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"ok": False, "message": "JSON body required"}), 400

    ip = data.get("ip")
    port = data.get("port")
    username = data.get("username") or state.get("shared_username")
    password = data.get("password") or state.get("shared_password")

    if not ip:
        return jsonify({"ok": False, "message": "camera ip required"}), 400
    if not username or not password:
        return jsonify({"ok": False, "message": "username and password required"}), 400

    try:
        onvif_res = try_onvif_connect(ip, username, password, preferred_ports=[port] if port else [])
        if not onvif_res["success"]:
            return jsonify({"ok": False, "message": "authentication/ONVIF failed", "error": onvif_res["error"]}), 401

        cam = onvif_res["cam"]
        profiles = onvif_res["profiles"]
        media = cam.create_media_service()
        token = profiles[0].token

        stream_uri = media.GetStreamUri({
            'StreamSetup': {'Stream': 'RTP-Unicast', 'Transport': {'Protocol': 'RTSP'}},
            'ProfileToken': token
        })
        clean_uri = getattr(stream_uri, "Uri", None) or stream_uri
        rtsp_with_auth = inject_credentials_into_rtsp(clean_uri, username, password)

        camera_id = f"onvif-{ip.replace('.', '-')}"
        payload = {
            "camera_id": camera_id,
            "camera_type": "onvif",
            "rtsp_url": rtsp_with_auth,
            "site_id": "onvif-site",
            "enabled": True,
            "meta": {"location": camera_id, "source": "onvif-discovery"}
        }

        ok, info = post_to_pipeline(payload)
        if ok:
            return jsonify({"ok": True, "message": "camera validated and activated", "rtsp_url": rtsp_with_auth}), 200
        else:
            return jsonify({"ok": False, "message": "validated but pipeline activation failed", "detail": info}), 502

    except Exception as e:
        safe_print_exc("[validate_camera] exception")
        return jsonify({"ok": False, "message": "unexpected error", "error": str(e)}), 500


# ---------------- Shared credentials ----------------
@app.route("/set_credentials", methods=["POST"])
def set_credentials():
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"ok": False, "message": "JSON body required"}), 400

    username = data.get("username")
    password = data.get("password")
    if not username or not password:
        return jsonify({"ok": False, "message": "username and password required"}), 400

    state["shared_username"] = username
    state["shared_password"] = password
    print(f"[CREDENTIALS] Shared credentials set for {username}")
    return jsonify({"ok": True, "message": "shared credentials stored in memory"}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "ok": True,
        "last_discovered_at": state.get("last_discovered_at"),
        "last_discovered_count": len(state.get("last_discovered", []))
    })


# ---------------- Run ----------------
if __name__ == "__main__":
    bind = os.environ.get("DISCOVERY_BIND", "0.0.0.0")
    port = int(os.environ.get("DISCOVERY_PORT", 5001))

    # Show both the service and trigger URL clearly
    print(f"🔵 ONVIF discovery/validation service running at:")
    print(f"   → Base URL:     http://{bind}:{port}")
    print(f"   → Trigger URL:  http://localhost:{port}/discover")

    app.run(host=bind, port=port)

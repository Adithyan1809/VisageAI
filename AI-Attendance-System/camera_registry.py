import asyncio
import json
import logging
from typing import Dict, Any, List

from aiohttp import web
from db_utils import get_db_manager

logger = logging.getLogger("camera_registry")


class CameraConfig:
    def __init__(self, camera_id: str, rtsp_url: str, site_id: str = None, meta: Dict[str, Any] = None,
                 fps_skip: int = 5, disabled: bool = False, camera_type: str = "generic"):
        self.camera_id = camera_id
        self.rtsp_url = rtsp_url
        self.site_id = site_id
        self.meta = meta or {}
        self.fps_skip = fps_skip
        self.disabled = disabled
        self.camera_type = camera_type

    def to_dict(self):
        return {
            "camera_id": self.camera_id,
            "rtsp_url": self.rtsp_url,
            "site_id": self.site_id,
            "meta": self.meta,
            "fps_skip": self.fps_skip,
            "disabled": self.disabled,
            "camera_type": self.camera_type,
        }


class CameraRegistry:
    """
    In-memory camera registry.
    Normally loads from file, but can also dynamically add cameras (like ONVIF-discovered ones).
    """

    def __init__(self, initial_cameras: Dict[str, CameraConfig] = None):
        self._cameras: Dict[str, CameraConfig] = initial_cameras or {}
        self._listeners = []  # callbacks to call on add/remove/update
        self._lock = asyncio.Lock()
        self._db = get_db_manager()
        self._sync_task = None
        self._stop_event = asyncio.Event()

    def register_listener(self, callback):
        """callback(camera_id, action, CameraConfig) called on add/remove"""
        self._listeners.append(callback)

    async def notify_listeners(self, camera_id: str, action: str, cfg: CameraConfig):
        for cb in list(self._listeners):
            try:
                await cb(camera_id, action, cfg)
            except Exception:
                logger.exception("Listener error")

    async def load_from_file(self, path: str):
        """Optional: load cameras.json if present."""
        try:
            async with self._lock:
                with open(path, "r") as f:
                    data = json.load(f)
                for c in data.get("cameras", []):
                    cfg = CameraConfig(
                        camera_id=c["camera_id"],
                        rtsp_url=c["rtsp_url"],
                        site_id=c.get("site_id"),
                        meta=c.get("meta", {}),
                        fps_skip=c.get("fps_skip", 5),
                        disabled=c.get("disabled", False),
                        camera_type=c.get("camera_type", "generic"),
                    )
                    self._cameras[cfg.camera_id] = cfg
            logger.info("Loaded camera config from %s", path)
        except FileNotFoundError:
            logger.warning("No cameras.json found; continuing with empty registry (ONVIF only mode)")
        except Exception as e:
            logger.error(f"Failed to load cameras.json: {e}", exc_info=True)

    async def start_db_sync(self):
        """Start background task to sync cameras from PostgreSQL."""
        if not self._sync_task:
            self._stop_event.clear()
            self._sync_task = asyncio.create_task(self._db_sync_loop())
            logger.info("Started CameraRegistry DB sync task.")

    async def stop_db_sync(self):
        """Stop background DB sync task."""
        self._stop_event.set()
        if self._sync_task:
            self._sync_task.cancel()
            try:
                await self._sync_task
            except asyncio.CancelledError:
                pass
            self._sync_task = None
            logger.info("Stopped CameraRegistry DB sync task.")

    async def _db_sync_loop(self):
        """Periodically fetches cameras from PostgreSQL and synchronizes with the registry."""
        await self._db.create_pool()
        
        while not self._stop_event.is_set():
            try:
                async with self._db.pool.acquire() as conn:
                    # Fetch all active cameras with an RTSP URL
                    records = await conn.fetch(
                        "SELECT id, rtsp_url, name, zone_id, status FROM cameras WHERE status = 'active' AND rtsp_url IS NOT NULL"
                    )
                
                db_cameras = {str(rec['id']): rec for rec in records}
                
                async with self._lock:
                    current_ids = set(self._cameras.keys())
                db_ids = set(db_cameras.keys())
                
                # Add new cameras
                for cid in db_ids - current_ids:
                    rec = db_cameras[cid]
                    cfg = CameraConfig(
                        camera_id=cid,
                        rtsp_url=rec['rtsp_url'],
                        meta={"name": rec['name'], "location": rec['zone_id']}
                    )
                    # Use internal map directly then notify, to avoid double lock in add_camera
                    async with self._lock:
                        self._cameras[cid] = cfg
                    await self.notify_listeners(cid, "add", cfg)
                    logger.info("DB Sync: Added camera %s", cid)
                
                # Remove deleted or disabled cameras
                for cid in current_ids - db_ids:
                    # Don't remove purely local onvif cameras managed externally
                    if not cid.startswith("onvif-"):
                        async with self._lock:
                            cfg = self._cameras.pop(cid, None)
                        if cfg:
                            await self.notify_listeners(cid, "remove", cfg)
                            logger.info("DB Sync: Removed camera %s", cid)
                
                # Update existing cameras if RTSP changed
                for cid in current_ids.intersection(db_ids):
                    rec = db_cameras[cid]
                    async with self._lock:
                        cfg = self._cameras[cid]
                        needs_update = False
                        if cfg.rtsp_url != rec['rtsp_url']:
                            cfg.rtsp_url = rec['rtsp_url']
                            needs_update = True
                        if cfg.meta.get("name") != rec['name']:
                            cfg.meta["name"] = rec['name']
                        if cfg.meta.get("location") != rec['zone_id']:
                            cfg.meta["location"] = rec['zone_id']
                            
                    if needs_update:
                        await self.notify_listeners(cid, "update", cfg)
                        logger.info("DB Sync: Updated camera %s", cid)
                        
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"DB Sync loop error: {e}", exc_info=True)
            
            # Wait before next poll
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=10.0)
            except asyncio.TimeoutError:
                pass

    async def add_camera(self, cfg: CameraConfig):
        async with self._lock:
            if cfg.camera_id in self._cameras:
                raise KeyError("camera exists")
            self._cameras[cfg.camera_id] = cfg
        await self.notify_listeners(cfg.camera_id, "add", cfg)
        logger.info("Camera %s added", cfg.camera_id)

    async def bulk_add_cameras(self, camera_list: List[Dict[str, Any]]):
        """Add multiple ONVIF cameras at once (used by ONVIF discovery)."""
        added = []
        for cam in camera_list:
            try:
                cfg = CameraConfig(
                    camera_id=cam.get("camera_id"),
                    rtsp_url=cam.get("rtsp_url"),
                    site_id=cam.get("site_id", "onvif-site"),
                    meta=cam.get("meta", {}),
                    fps_skip=cam.get("fps_skip", 5),
                    disabled=cam.get("disabled", False),
                    camera_type=cam.get("camera_type", "onvif"),
                )
                await self.add_camera(cfg)
                added.append(cfg.camera_id)
            except KeyError:
                logger.warning("Camera %s already exists, skipping", cam.get("camera_id"))
        return added

    async def update_camera(self, camera_id: str, **kwargs):
        async with self._lock:
            if camera_id not in self._cameras:
                raise KeyError("camera missing")
            cfg = self._cameras[camera_id]
            for k, v in kwargs.items():
                if hasattr(cfg, k):
                    setattr(cfg, k, v)
            self._cameras[camera_id] = cfg
        await self.notify_listeners(camera_id, "update", self._cameras[camera_id])
        logger.info("Camera %s updated", camera_id)

    async def remove_camera(self, camera_id: str):
        async with self._lock:
            cfg = self._cameras.pop(camera_id, None)
        if cfg:
            await self.notify_listeners(camera_id, "remove", cfg)
            logger.info("Camera %s removed", camera_id)

    async def list_cameras(self):
        async with self._lock:
            return {cid: cfg.to_dict() for cid, cfg in self._cameras.items()}

    async def get_camera(self, camera_id: str):
        async with self._lock:
            return self._cameras.get(camera_id)


# --------------------------- HTTP CONTROL API ---------------------------
async def make_registry_app(registry: CameraRegistry):
    app = web.Application()

    async def list_handler(request):
        cams = await registry.list_cameras()
        return web.json_response({"cameras": cams})

    async def add_handler(request):
        """POST /cameras - Add new camera (ONVIF or manual)."""
        body = await request.json()
        try:
            cfg = CameraConfig(
                camera_id=body["camera_id"],
                rtsp_url=body["rtsp_url"],
                site_id=body.get("site_id"),
                meta=body.get("meta", {}),
                fps_skip=body.get("fps_skip", 5),
                camera_type=body.get("camera_type", "onvif"),
            )
            await registry.add_camera(cfg)
            return web.json_response({"status": "ok", "camera_id": cfg.camera_id})
        except KeyError:
            return web.json_response({"error": "exists"}, status=400)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    async def remove_handler(request):
        camera_id = request.match_info["camera_id"]
        await registry.remove_camera(camera_id)
        return web.json_response({"status": "ok"})

    app.add_routes([
        web.get("/", lambda request: web.Response(text="Camera Registry API is running!")),
        web.get("/cameras", list_handler),
        web.post("/cameras", add_handler),
        web.delete("/cameras/{camera_id}", remove_handler),
    ])

    return app

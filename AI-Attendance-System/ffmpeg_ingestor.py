# ffmpeg_ingestor.py
import asyncio
import logging
import os
import signal
import time
from typing import Any, Dict, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)


class FFmpegCamera:
    """
    Reads a single camera (RTSP / HTTP / webcam / opencv), encodes frames to JPEG bytes,
    and pushes them to an async queue. Honors a shared throttle flag to drop frames
    when downstream is overloaded. Uses configured ingest width/height to reduce memory.
    """

    def __init__(
            self,
            cfg: Any,
            out_queue: asyncio.Queue,
            ingest_width: int = 640,
            ingest_height: int = 360,
            throttle_map: Optional[Dict[str, bool]] = None,
    ):
        self.cfg = cfg
        self.out_queue = out_queue
        self.width = ingest_width
        self.height = ingest_height
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._stderr_task: Optional[asyncio.Task] = None
        # throttle_map is a shared dict managed by FFmpegIngestorManager to instruct cameras to drop frames
        self.throttle_map = throttle_map or {}

    def _ffmpeg_cmd(self, source: str):
        if source and source.startswith("opencv:"):
            return None

        if source and (source.startswith("rtsp://") or source.startswith("http://")):
            return [
                "ffmpeg",
                "-rtsp_transport", "tcp",
                "-fflags", "nobuffer",
                "-flags", "low_delay",
                "-i", source,
                "-an",
                "-pix_fmt", "bgr24",
                "-s", f"{self.width}x{self.height}",
                "-f", "rawvideo",
                "-loglevel", "warning",
                "pipe:1",
            ]

        if source and source.startswith("webcam"):
            idx = 0
            if ":" in source:
                try:
                    idx = int(source.split(":", 1)[1])
                except Exception:
                    idx = 0
            # Use OpenCV path for webcams
            return f"opencv:{idx}"

        raise ValueError(f"Invalid camera source: {source}")

    async def _log_ffmpeg_stderr(self, stream: asyncio.StreamReader):
        try:
            while not stream.at_eof():
                line = await stream.readline()
                if not line:
                    break
                msg = line.decode(errors="ignore").strip()
                if msg:
                    logger.debug("[%s ffmpeg] %s", self.cfg.camera_id, msg)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("[%s ffmpeg] stderr logger stopped", self.cfg.camera_id)

    async def run(self, stop_event: asyncio.Event):
        """Main loop: spawn ffmpeg or use OpenCV, encode frames as JPEG bytes and push to out_queue."""
        if self.cfg.rtsp_url.startswith("opencv:"):
            await self._run_opencv(stop_event)
            return

        frame_size = self.width * self.height * 3
        backoff = 1

        while not stop_event.is_set():
            cmd = self._ffmpeg_cmd(self.cfg.rtsp_url)
            logger.info("[%s] starting ffmpeg", self.cfg.camera_id)

            try:
                self._proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    start_new_session=True,  # allow killing the whole ffmpeg process group on shutdown
                )

                if self._proc.stderr:
                    self._stderr_task = asyncio.create_task(self._log_ffmpeg_stderr(self._proc.stderr))

                while not stop_event.is_set():
                    # If throttle flag is set, drop reading frames briefly to reduce load
                    if self.throttle_map.get(self.cfg.camera_id, False):
                        # skip a short window to reduce CPU/IO
                        await asyncio.sleep(0.05)
                        # continue to attempt to read but skip pushing frames
                    try:
                        raw = await self._proc.stdout.readexactly(frame_size)
                    except asyncio.IncompleteReadError:
                        logger.warning("[%s] short read, restarting ffmpeg", self.cfg.camera_id)
                        break
                    except Exception as e:
                        logger.exception("[%s] ffmpeg stdout read failed: %s", self.cfg.camera_id, e)
                        break

                    # If downstream is throttling, drop this frame early (backpressure propagation)
                    if self.throttle_map.get(self.cfg.camera_id, False):
                        continue

                    # encode to JPEG bytes for smaller memory footprint downstream
                    try:
                        frame = np.frombuffer(raw, np.uint8).reshape((self.height, self.width, 3))
                        ok, jpg = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                        if not ok:
                            continue
                        payload = {
                            "camera_id": self.cfg.camera_id,
                            "timestamp": time.time(),
                            "frame": jpg.tobytes(),  # JPEG bytes (memory-efficient)
                            "meta": getattr(self.cfg, "meta", {}),
                        }
                        try:
                            # Non-blocking put with short timeout; drop if not possible
                            await asyncio.wait_for(self.out_queue.put(payload), timeout=0.5)
                        except asyncio.TimeoutError:
                            # If put times out, signal manager to throttle this camera (set throttle flag).
                            logger.warning("[%s] out_queue full; dropping frame and advising throttle",
                                           self.cfg.camera_id)
                            self.throttle_map[self.cfg.camera_id] = True
                    except Exception:
                        logger.exception("[%s] frame handling error", self.cfg.camera_id)

                if self._proc:
                    try:
                        await self._proc.wait()
                    except Exception:
                        pass
                self._proc = None

            except Exception:
                logger.exception("[%s] ffmpeg process failed", self.cfg.camera_id)

            # cleanup stderr task
            if self._stderr_task:
                self._stderr_task.cancel()
                try:
                    await self._stderr_task
                except Exception:
                    pass
                self._stderr_task = None

            if not stop_event.is_set():
                logger.info("[%s] restarting in %ds", self.cfg.camera_id, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

        await self._terminate_proc()
        logger.info("[%s] camera loop stopped", self.cfg.camera_id)

    async def _run_opencv(self, stop_event: asyncio.Event):
        try:
            index = int(self.cfg.rtsp_url.split(":", 1)[1])
        except Exception:
            index = 0

        cap = cv2.VideoCapture(index)
        if not cap.isOpened():
            logger.error("[%s] failed to open OpenCV camera %d", self.cfg.camera_id, index)
            return

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)

        try:
            while not stop_event.is_set():
                if self.throttle_map.get(self.cfg.camera_id, False):
                    await asyncio.sleep(0.05)
                ret, frame = cap.read()
                if not ret:
                    logger.warning("[%s] opencv read failed; retrying", self.cfg.camera_id)
                    await asyncio.sleep(0.1)
                    continue

                if self.throttle_map.get(self.cfg.camera_id, False):
                    continue

                ok, jpg = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                if not ok:
                    continue

                payload = {
                    "camera_id": self.cfg.camera_id,
                    "timestamp": time.time(),
                    "frame": jpg.tobytes(),
                    "meta": getattr(self.cfg, "meta", {}),
                }

                try:
                    await asyncio.wait_for(self.out_queue.put(payload), timeout=0.5)
                except asyncio.TimeoutError:
                    logger.warning("[%s] out_queue full; dropping frame and advising throttle", self.cfg.camera_id)
                    self.throttle_map[self.cfg.camera_id] = True

                await asyncio.sleep(0.033)
        finally:
            cap.release()
            logger.info("[%s] OpenCV camera stopped", self.cfg.camera_id)

    async def _terminate_proc(self):
        if not self._proc:
            return
        pid = self._proc.pid

        # Cancel stderr logger first so it does not keep the process alive
        if self._stderr_task:
            self._stderr_task.cancel()
            try:
                await self._stderr_task
            except Exception:
                pass
            self._stderr_task = None

        try:
            if pid:
                # SIGTERM the whole group to free the camera quickly
                os.killpg(pid, signal.SIGTERM)
            else:
                self._proc.terminate()
        except Exception:
            try:
                self._proc.terminate()
            except Exception:
                pass

        try:
            await asyncio.wait_for(self._proc.wait(), timeout=3.0)
        except asyncio.TimeoutError:
            try:
                if pid:
                    os.killpg(pid, signal.SIGKILL)
            except Exception:
                pass
            try:
                self._proc.kill()
            except Exception:
                pass
            try:
                await self._proc.wait()
            except Exception:
                pass

        self._proc = None


class FFmpegIngestorManager:
    """
    Manage FFmpegCamera instances and provide a shared throttle map used for backpressure propagation.
    """

    def __init__(self, registry: Any, out_queue: asyncio.Queue, ingest_width: int = 640, ingest_height: int = 360):
        self.registry = registry
        self.out_queue = out_queue
        self._cameras: Dict[str, Tuple[FFmpegCamera, asyncio.Task]] = {}
        self.stop_event: Optional[asyncio.Event] = None
        self.ingest_width = ingest_width
        self.ingest_height = ingest_height
        # throttle_map maps camera_id -> bool. Manager controls these flags based on queue pressure.
        self.throttle_map: Dict[str, bool] = {}
        registry.register_listener(self._on_registry_event)

    async def start_all(self, stop_event: asyncio.Event):
        self.stop_event = stop_event
        cams = await self.registry.list_cameras()
        for cid, cfg_data in cams.items():
            if cfg_data.get("disabled"):
                continue
            cfg = await self.registry.get_camera(cid)
            await self.add_camera(cfg, stop_event)

    async def add_camera(self, cfg: Any, stop_event: Optional[asyncio.Event] = None):
        if cfg.camera_id in self._cameras:
            logger.warning("[%s] already running", cfg.camera_id)
            return

        if stop_event is None:
            stop_event = self.stop_event
            if stop_event is None:
                logger.error("No stop_event available; cannot start camera %s", cfg.camera_id)
                return

        # initialize throttle flag
        self.throttle_map[cfg.camera_id] = False
        cam = FFmpegCamera(cfg, self.out_queue, ingest_width=self.ingest_width, ingest_height=self.ingest_height,
                           throttle_map=self.throttle_map)
        task = asyncio.create_task(cam.run(stop_event))
        self._cameras[cfg.camera_id] = (cam, task)
        logger.info("[%s] camera started", cfg.camera_id)

    async def stop_camera(self, camera_id: str):
        cam_tuple = self._cameras.pop(camera_id, None)
        if not cam_tuple:
            return
        cam, task = cam_tuple
        try:
            await cam._terminate_proc()
        except Exception:
            logger.debug("[%s] error terminating camera proc", camera_id)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.debug("[%s] camera task stopped with exception", camera_id)
        # cleanup throttle flag
        self.throttle_map.pop(camera_id, None)
        logger.info("[%s] camera stopped", camera_id)

    async def _on_registry_event(self, camera_id: str, action: str, cfg: Any):
        if not self.stop_event:
            logger.error("Registry event received before start_all; ignoring event for %s", camera_id)
            return

        if action == "add":
            await self.add_camera(cfg, self.stop_event)
        elif action == "remove":
            await self.stop_camera(camera_id)
        elif action == "update":
            await self.stop_camera(camera_id)
            await self.add_camera(cfg, self.stop_event)

    async def stop_all(self):
        tasks = []
        for camera_id in list(self._cameras.keys()):
            tasks.append(self.stop_camera(camera_id))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

import asyncio
import logging
import signal
from pathlib import Path

# Logging Configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)

import yaml
from aiohttp import web
from aiohttp_middlewares import cors_middleware

from best_frame_selector import BestFrameSelector
from camera_registry import CameraRegistry, make_registry_app
from face_detector import detector_worker
from ffmpeg_ingestor import FFmpegIngestorManager
from pipeline_worker import FaceRecognitionPipeline
from tracker_deepsort import tracker_worker as deepsort_worker
from tracker_dispatcher import TrackerDispatcher


logger = logging.getLogger("main")

# --------------------------- API SECURITY ---------------------------
def make_auth_middleware(api_token: str | None):
    """Simple Bearer token auth middleware for production."""

    @web.middleware
    async def auth_middleware(request, handler):
        if api_token:
            auth = request.headers.get("Authorization", "")
            if not auth.startswith("Bearer ") or auth.split(" ", 1)[1] != api_token:
                return web.json_response({"error": "Unauthorized"}, status=401)
        return await handler(request)

    return auth_middleware


# --------------------------- DISPATCH LOOP ---------------------------
async def dispatch_loop(detector_q: asyncio.Queue, dispatcher_obj: TrackerDispatcher, stop_evt: asyncio.Event):
    """Consumes frames from detector queue and dispatches them to the correct tracker worker."""
    logger.info("[DispatchLoop] Started.")
    try:
        while not stop_evt.is_set():
            try:
                data = await asyncio.wait_for(detector_q.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            if data is None:
                detector_q.task_done()
                continue

            try:
                dispatcher_obj.dispatch(
                    data["camera_id"],
                    data["frame"],  # now optimized as JPEG bytes to save memory
                    data["detections"],
                    data.get("timestamp", 0)
                )
            except asyncio.QueueFull:
                logger.warning(f"[DispatchLoop] Tracker queue full. Dropping frame from {data.get('camera_id')}.")
            except Exception as e:
                logger.error(f"Error dispatching frame: {e}", exc_info=True)

            detector_q.task_done()
    except asyncio.CancelledError:
        logger.info("[DispatchLoop] Cancelled.")
    finally:
        logger.info("[DispatchLoop] Stopped. Signaling trackers to stop.")
        await dispatcher_obj.stop_all()


# --------------------------- SHUTDOWN HANDLER ---------------------------
async def shutdown(sig: signal.Signals, loop: asyncio.AbstractEventLoop, stop_event: asyncio.Event):
    """Graceful shutdown on SIGINT/SIGTERM."""
    logger.info(f"Received exit signal {sig.name}...")
    if not stop_event.is_set():
        stop_event.set()


# --------------------------- MAIN PIPELINE ---------------------------
async def main():
    root_dir = Path(__file__).resolve().parent
    config_path = root_dir / "config.yaml"
    cameras_path = root_dir / "cameras.json"

    # --------------------------- LOAD CONFIG ---------------------------
    config = {}
    if config_path.exists():
        with open(config_path, "r") as f:
            config = yaml.safe_load(f)
        logger.info("Loaded config.yaml successfully")
    else:
        logger.warning("config.yaml not found; using defaults")

    tracker_type = config.get("tracker", "deepsort").lower()
    num_detectors = int(config.get("num_detectors", 4))
    num_trackers = int(config.get("num_trackers", 2))
    track_timeout = float(config.get("track_timeout_seconds", 3.0))

    # Configurable thresholds and performance parameters
    ingest_width = int(config.get("ingest_width", 640))
    ingest_height = int(config.get("ingest_height", 360))
    detector_width = int(config.get("detector_width", 640))
    detector_height = int(config.get("detector_height", 360))

    # Queue thresholds for adaptive control
    detector_queue_high = int(config.get("detector_queue_high", 400))
    detector_queue_low = int(config.get("detector_queue_low", 250))
    throttle_cooldown = float(config.get("throttle_cooldown_seconds", 5.0))

    # Secure API configuration
    api_token = config.get("api_token", None)
    allowed_origins = config.get("api_allowed_origins", ["http://localhost:3000"])

    logger.info(f"Tracker: {tracker_type}, Detectors: {num_detectors}, Trackers: {num_trackers}")

    # --------------------------- PIPELINE QUEUES ---------------------------
    frame_queue = asyncio.Queue(maxsize=50)
    detector_queue = asyncio.Queue(maxsize=500)
    tracker_output_queue = asyncio.Queue(maxsize=500)
    recognition_batch_queue = asyncio.Queue(maxsize=100)

    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    # --------------------------- SIGNAL HANDLERS ---------------------------
    def setup_signal_handlers():
        logger.info("Setting up signal handlers...")
        try:
            for sig in (signal.SIGINT, signal.SIGTERM):
                loop.add_signal_handler(sig, lambda s=sig: asyncio.create_task(shutdown(s, loop, stop_event)))
        except NotImplementedError:
            signal.signal(signal.SIGINT, lambda s, f: asyncio.create_task(shutdown(s, loop, stop_event)))

    setup_signal_handlers()

    all_tasks = []

    # --------------------------- CAMERA REGISTRY + API ---------------------------
    registry = CameraRegistry()
    await registry.load_from_file(str(cameras_path))
    app = await make_registry_app(registry)

    # Secure middlewares
    if api_token:
        app.middlewares.append(make_auth_middleware(api_token))
    app.middlewares.append(cors_middleware(origins=allowed_origins))

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8081)
    await site.start()
    logger.info("HTTP API running securely on port 8081")

    # --------------------------- FFMPEG INGESTOR ---------------------------
    manager = FFmpegIngestorManager(registry, frame_queue, ingest_width, ingest_height)
    manager_task = asyncio.create_task(manager.start_all(stop_event))
    all_tasks.append(manager_task)

    # --------------------------- DETECTOR WORKERS ---------------------------
    detector_tasks = [
        asyncio.create_task(detector_worker(frame_queue, detector_queue, stop_event,
                                            decode_width=detector_width,
                                            decode_height=detector_height))
        for _ in range(num_detectors)
    ]
    all_tasks.extend(detector_tasks)
    logger.info(f"Started {num_detectors} detector workers.")

    # --------------------------- TRACKER DISPATCHER ---------------------------
    dispatcher = TrackerDispatcher(num_trackers, stop_event)

    # --------------------------- BEST FRAME SELECTOR ---------------------------
    # selector = BestFrameSelector(top_k=5, track_timeout_seconds=track_timeout)
    # selector_task = asyncio.create_task(
    #     selector.run(tracker_output_queue, recognition_batch_queue, stop_event)
    # )

    # --------------------------- DISPATCHER LOOP ---------------------------
    dispatcher_task = asyncio.create_task(dispatch_loop(detector_queue, dispatcher, stop_event))
    all_tasks.append(dispatcher_task)

    # --------------------------- TRACKER WORKERS ---------------------------
    tracker_tasks = []
    for i in range(num_trackers):
        q = dispatcher.queues[i]
        if tracker_type == "deepsort":
            task = asyncio.create_task(deepsort_worker(q, tracker_output_queue, stop_event))
            tracker_tasks.append(task)
    all_tasks.extend(tracker_tasks)
    logger.info(f"Started {num_trackers} {tracker_type} tracker workers.")

    # --- BEST FRAME SELECTOR INTEGRATION ---
    selector_config = config.get("selector", {})  # Get the 'selector' block

    selector = BestFrameSelector(
        top_k=selector_config.get("top_k", 5),
        track_timeout_seconds=selector_config.get("track_timeout_seconds", 3.0),
        trigger_threshold=selector_config.get("trigger_threshold", 0.5),
        sent_mute_seconds=selector_config.get("sent_mute_seconds", 10.0)  # Pass it in
    )
    selector_task = asyncio.create_task(
        selector.run(tracker_output_queue, recognition_batch_queue, stop_event)
    )
    all_tasks.append(selector_task)

    # --- Real Recognition Pipeline Worker ---
    recog_config = config.get("recognition", {})  # Get the 'recognition' block

    recognition_pipeline = FaceRecognitionPipeline(
        queue=recognition_batch_queue,
        cosine_threshold=recog_config.get("cosine_threshold", 0.75),
        majority_threshold=recog_config.get("majority_threshold", 5),
        margin_threshold=recog_config.get("margin_threshold", 0.08)
    )
    recognition_task = asyncio.create_task(recognition_pipeline.run())
    all_tasks.append(recognition_task)

    # --------------------------- BACKPRESSURE MAINTAINER ---------------------------
    async def detector_queue_maintainer():
        """Drop oldest frames and throttle cameras under heavy load."""
        logger.info("[Maintainer] Started for adaptive rate control.")
        last_throttle_clear = {}

        while not stop_event.is_set():
            try:
                await asyncio.sleep(0.5)
                qsize = detector_queue.qsize()
                if qsize > detector_queue_high:
                    drop_count = 0
                    while detector_queue.qsize() > detector_queue_low:
                        try:
                            _ = detector_queue.get_nowait()
                            detector_queue.task_done()
                            drop_count += 1
                        except asyncio.QueueEmpty:
                            break
                    if drop_count:
                        logger.warning(
                            f"[Maintainer] Dropped {drop_count} frames (queue size: {qsize})."
                        )

                    # Identify active cameras to throttle
                    try:
                        cameras_in_queue = {i.get("camera_id") for i in detector_queue._queue if isinstance(i, dict)}
                        for cam_id in cameras_in_queue:
                            manager.throttle_map[cam_id] = True
                            last_throttle_clear[cam_id] = loop.time()
                    except Exception:
                        pass

                # Cooldown to unthrottle
                now = loop.time()
                for cam, ts in list(last_throttle_clear.items()):
                    if (now - ts) > throttle_cooldown:
                        manager.throttle_map[cam] = False
                        last_throttle_clear.pop(cam, None)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[Maintainer] Error: {e}", exc_info=True)

        logger.info("[Maintainer] Stopped.")

    maintainer_task = asyncio.create_task(detector_queue_maintainer())
    all_tasks.append(maintainer_task)

    # --------------------------- STARTUP SUMMARY ---------------------------
    logger.info(f"""
🟢 Pipeline Ready (Production)
   HTTP API:        http://0.0.0.0:8081
   Detectors:       {num_detectors}
   Trackers:        {num_trackers} ({tracker_type})
   Config:          {config_path}
   Cameras:         {cameras_path}
Press Ctrl+C to stop.
""")

    # --------------------------- WAIT FOR STOP ---------------------------
    try:
        await stop_event.wait()
    finally:
        logger.info("Shutting down services...")

        await manager.stop_all()

        for _ in range(num_detectors):
            await frame_queue.put(None)

        await detector_queue.put(None)

        for q in dispatcher.queues:
            await q.put(None)

        for t in all_tasks:
            t.cancel()
        await asyncio.gather(*all_tasks, return_exceptions=True)

        await site.stop()
        await runner.cleanup()
        logger.info("✅ Shutdown complete.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("KeyboardInterrupt received. Exiting gracefully...")
    except asyncio.CancelledError:
        logger.info("Asyncio loop cancelled.")
    finally:
        logger.info("Application terminated.")
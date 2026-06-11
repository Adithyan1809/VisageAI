# tracker_dispatcher.py
import asyncio
import logging
from itertools import cycle  # Import cycle for more efficient round-robin

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("tracker-dispatcher")


class TrackerDispatcher:
    """
    Receives frames from multiple detector workers and dispatches them to tracker workers.
    Uses a round-robin scheme to distribute frames to multiple tracker workers.
    """

    def __init__(self, num_workers: int, stop_event: asyncio.Event):
        # Ensure it's an integer and store
        self.num_workers = int(num_workers)
        self.stop_event = stop_event
        # Queues are the main communication channel
        self.queues = [asyncio.Queue(maxsize=200) for _ in range(self.num_workers)]

        # Use itertools.cycle for a cleaner, slightly more performant round-robin selection
        # This pre-initializes the iterator, avoiding a repeated modulo operation in 'dispatch'
        self._queue_cycler = cycle(self.queues)
        # _counter is no longer strictly needed but kept for potential logging/debugging
        self._counter = 0

    def dispatch(self, camera_id: str, frame, detections, timestamp=0):
        """
        Dispatch a single frame and its detections to a tracker worker.
        """
        # Get the next queue from the cycle iterator
        queue = next(self._queue_cycler)
        self._counter += 1  # Only for debug tracking

        # put_nowait is critical for non-blocking dispatch
        queue.put_nowait({
            "camera_id": camera_id,
            "frame": frame,
            "detections": detections,
            "timestamp": timestamp
        })

    async def stop_all(self):
        """
        Gracefully stop all tracker queues by sending None and setting stop_event.
        """
        # Ensure the stop event is set first
        self.stop_event.set()
        # Send shutdown signal to all queues
        for q in self.queues:
            await q.put(None)
        logger.info("[Dispatcher] Stop signal sent to all tracker queues.")

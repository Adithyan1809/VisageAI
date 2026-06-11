"""Queue monitoring and metrics tracking for pipeline health."""

import asyncio
import logging
import time
from typing import Generic, TypeVar

logger = logging.getLogger("queue_monitor")

T = TypeVar('T')


class MonitoredQueue(Generic[T]):
    """Wraps asyncio.Queue with metrics tracking for monitoring queue health.
    
    Tracks:
    - Current queue size
    - Maximum queue size observed
    - Items dropped due to full queue
    - Processing rate (items/sec)
    - Average wait time for consumers
    """
    
    def __init__(self, maxsize: int = 0, name: str = "queue"):
        self._queue = asyncio.Queue(maxsize=maxsize)
        self.name = name
        self.maxsize = maxsize
        
        # Metrics
        self.max_size_seen = 0
        self.items_dropped = 0
        self.total_items_processed = 0
        self.total_put_time = 0.0
        self.total_get_time = 0.0
        self.last_log_time = time.time()
        self.items_since_log = 0
        
    async def put(self, item: T) -> None:
        """Put an item in the queue, tracking metrics."""
        start = time.time()
        try:
            self._queue.put_nowait(item)
        except asyncio.QueueFull:
            self.items_dropped += 1
            logger.warning(f"[{self.name}] Queue full - dropped item (total dropped: {self.items_dropped})")
            # Try again with wait (backpressure)
            await self._queue.put(item)
        
        self.total_put_time += time.time() - start
        current_size = self._queue.qsize()
        if current_size > self.max_size_seen:
            self.max_size_seen = current_size
    
    async def get(self) -> T:
        """Get an item from the queue, tracking metrics."""
        start = time.time()
        item = await self._queue.get()
        self.total_get_time += time.time() - start
        self.total_items_processed += 1
        self.items_since_log += 1
        
        # Log metrics periodically (every 30 seconds)
        now = time.time()
        if now - self.last_log_time > 30:
            self._log_metrics()
            self.last_log_time = now
            self.items_since_log = 0
        
        return item
    
    def put_nowait(self, item: T) -> None:
        """Non-blocking put (may raise QueueFull)."""
        try:
            self._queue.put_nowait(item)
            current_size = self._queue.qsize()
            if current_size > self.max_size_seen:
                self.max_size_seen = current_size
        except asyncio.QueueFull:
            self.items_dropped += 1
            raise
    
    def get_nowait(self) -> T:
        """Non-blocking get (may raise QueueEmpty)."""
        self.total_items_processed += 1
        self.items_since_log += 1
        return self._queue.get_nowait()
    
    def qsize(self) -> int:
        """Return the current size of the queue."""
        return self._queue.qsize()
    
    def task_done(self) -> None:
        """Mark a task as done."""
        self._queue.task_done()
    
    async def join(self) -> None:
        """Wait until all items have been processed."""
        await self._queue.join()
    
    def _log_metrics(self) -> None:
        """Log queue metrics for monitoring."""
        current_size = self.qsize()
        utilization = (current_size / self.maxsize * 100) if self.maxsize > 0 else 0
        
        if self.items_since_log > 0:
            avg_put_time = (self.total_put_time / self.items_since_log) * 1000  # ms
            avg_get_time = (self.total_get_time / self.items_since_log) * 1000  # ms
        else:
            avg_put_time = avg_get_time = 0
        
        logger.info(
            f"[{self.name}] Metrics: "
            f"size={current_size}/{self.maxsize} ({utilization:.1f}%), "
            f"max_seen={self.max_size_seen}, "
            f"dropped={self.items_dropped}, "
            f"total_processed={self.total_items_processed}, "
            f"avg_put_time={avg_put_time:.2f}ms, "
            f"avg_get_time={avg_get_time:.2f}ms"
        )
    
    def get_metrics(self) -> dict:
        """Return current metrics as dict for API endpoints."""
        current_size = self.qsize()
        utilization = (current_size / self.maxsize * 100) if self.maxsize > 0 else 0
        
        return {
            "name": self.name,
            "current_size": current_size,
            "max_size": self.maxsize,
            "max_size_seen": self.max_size_seen,
            "utilization_percent": utilization,
            "items_dropped": self.items_dropped,
            "total_items_processed": self.total_items_processed,
        }


class QueueMetricsCollector:
    """Centralized collector for all queue metrics across the pipeline."""
    
    def __init__(self):
        self.queues: dict[str, MonitoredQueue] = {}
    
    def register(self, queue: MonitoredQueue, name: str) -> None:
        """Register a queue for monitoring."""
        self.queues[name] = queue
        logger.info(f"Registered queue: {name}")
    
    def get_all_metrics(self) -> dict:
        """Get metrics for all registered queues."""
        return {
            name: queue.get_metrics()
            for name, queue in self.queues.items()
        }
    
    def get_queue_metrics(self, name: str) -> dict | None:
        """Get metrics for a specific queue."""
        queue = self.queues.get(name)
        return queue.get_metrics() if queue else None
    
    def check_health(self) -> dict:
        """Check overall pipeline health based on queue metrics."""
        metrics = self.get_all_metrics()
        
        warnings = []
        for name, qm in metrics.items():
            if qm["utilization_percent"] > 80:
                warnings.append(f"Queue {name} is {qm['utilization_percent']:.1f}% full")
            if qm["items_dropped"] > 0:
                warnings.append(f"Queue {name} dropped {qm['items_dropped']} items")
        
        return {
            "healthy": len(warnings) == 0,
            "warnings": warnings,
            "queues": metrics,
        }


# Global metrics collector
metrics_collector = QueueMetricsCollector()

# backend/app/services/attendance_broadcaster.py
"""
Attendance broadcaster with Redis Pub/Sub support.

Behavior:
- If REDIS_URL is set and Redis is reachable, publish() will publish to the
  Redis channel `attendance` and listen() will subscribe to that channel.
- Otherwise, falls back to an in-process asyncio.Queue for single-process development.
"""

import os
import asyncio
import json
import logging
from typing import Dict, Any, AsyncGenerator
import redis.asyncio as aioredis

logger = logging.getLogger("attendance_broadcaster")

# Channel name for attendance events
ATTENDANCE_CHANNEL = os.environ.get("ATTENDANCE_CHANNEL", "attendance")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")

# Fallback in-process queue
_event_queue: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue()


async def _redis_client():
    try:
        r = aioredis.from_url(REDIS_URL)
        # try a ping to validate connection
        await r.ping()
        logger.info(f"Connected to Redis at {REDIS_URL} for attendance broadcaster")
        return r
    except Exception:
        logger.warning(f"Could not connect to Redis at {REDIS_URL}; falling back to in-process queue")
        return None


async def publish(event: Dict[str, Any]):
    """Publish a JSON-serializable event to Redis channel or in-process queue."""
    # Try Redis first
    r = await _redis_client()
    payload = json.dumps(event)
    if r:
        try:
            await r.publish(ATTENDANCE_CHANNEL, payload)
            logger.debug(f"Published event to Redis channel '{ATTENDANCE_CHANNEL}': {event}")
            return
        except Exception:
            logger.exception("Failed to publish to Redis; falling back to in-process queue")
            # fallback to queue
            pass

    await _event_queue.put(event)


async def listen() -> AsyncGenerator[Dict[str, Any], None]:
    """Async generator yielding events from Redis pubsub or in-process queue."""
    r = await _redis_client()
    if r:
        pubsub = r.pubsub()
        await pubsub.subscribe(ATTENDANCE_CHANNEL)
        logger.info(f"Subscribed to Redis channel '{ATTENDANCE_CHANNEL}' for attendance events")
        try:
            # aioredis pubsub returns messages as dicts via get_message or listen
            async for message in pubsub.listen():
                # message example: {'type': 'message', 'pattern': None, 'channel': b'attendance', 'data': b'{...}'}
                if message is None:
                    await asyncio.sleep(0.01)
                    continue
                mtype = message.get('type')
                if mtype == 'message':
                    data = message.get('data')
                    if isinstance(data, (bytes, bytearray)):
                        try:
                            ev = json.loads(data.decode('utf-8'))
                        except Exception:
                            ev = {'raw': data.decode('utf-8')}
                    else:
                        ev = data
                    logger.debug(f"Received attendance event from Redis: {ev}")
                    yield ev
        finally:
            try:
                await pubsub.unsubscribe(ATTENDANCE_CHANNEL)
            except Exception:
                pass
            try:
                await pubsub.close()
            except Exception:
                pass
    else:
        # Fallback to in-process queue
        logger.info("Using in-process attendance event queue (no Redis connection)")
        while True:
            ev = await _event_queue.get()
            logger.debug(f"Yielding event from in-process queue: {ev}")
            yield ev

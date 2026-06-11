"""pipeline_event_sender.py

Publish recognition events using Redis pub/sub. This file provides a
non-fatal `send_recognition_event` function used by the ML pipeline.
If Redis is not available, the function falls back to a no-op and logs
at debug level so the pipeline remains resilient.
"""
import os
import json
import logging
from typing import Dict, Any

logger = logging.getLogger("pipeline_event_sender")

# Redis connection URL (can set REDIS_URL env var)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
# Channel name to publish recognition events to; prefer ATTENDANCE_CHANNEL so
# the backend's attendance_broadcaster can pick events up automatically.
RECOGNITION_CHANNEL = os.getenv("ATTENDANCE_CHANNEL", os.getenv("RECOGNITION_CHANNEL", "attendance"))

try:
    import redis
    _redis_client = redis.from_url(REDIS_URL)
    # Test connection lazily when first used; don't raise here to keep pipeline safe
except Exception as e:
    logger.debug(f"Redis not available for pipeline event sender: {e}")
    _redis_client = None


def send_recognition_event(payload: Dict[str, Any]) -> bool:
    """Publish `payload` (JSON) to Redis pub/sub channel.

    Returns True on successful publish (published to at least one subscriber),
    False otherwise. This function never raises; it logs failures at debug
    or info level so the pipeline is not disrupted.
    """
    msg = json.dumps(payload, default=str)
    # Ensure we have a redis client (attempt to create if missing) and test connection
    client = _redis_client
    if client is None:
        try:
            import redis as _r
            client = _r.from_url(REDIS_URL)
            # Try a quick ping to validate connectivity
            try:
                client.ping()
            except Exception as ping_e:
                logger.debug(f"Redis client created but ping failed: {ping_e}")
                client = None
        except Exception as e:
            logger.debug(f"Redis not available when trying to publish: {e}")
            client = None

    if client is None:
        logger.warning("Redis publish skipped: no Redis client available. Set REDIS_URL and ensure 'redis' Python package is installed.")
        return False

    try:
        res = client.publish(RECOGNITION_CHANNEL, msg)
        if res:
            logger.info(f"Published recognition event to Redis channel '{RECOGNITION_CHANNEL}' (subscribers={res}): {payload}")
        else:
            logger.warning(f"Published recognition event but no subscribers on channel '{RECOGNITION_CHANNEL}': {payload}")
        return bool(res)
    except Exception as e:
        logger.debug(f"Failed to publish recognition event to Redis: {e}")
        return False

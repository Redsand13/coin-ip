"""Web Push notification service."""
import json
from typing import Any

from app.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class PushService:
    """Sends Web Push notifications to subscribed endpoints."""

    def __init__(self) -> None:
        self._vapid_ok = bool(settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY)

    async def send(self, subscription: dict, payload: dict[str, Any]) -> bool:
        if not self._vapid_ok:
            logger.debug("VAPID keys not configured — push skipped")
            return False

        try:
            from pywebpush import webpush, WebPushException
            webpush(
                subscription_info=subscription,
                data=json.dumps(payload),
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": f"mailto:{settings.VAPID_CLAIM_EMAIL}"},
            )
            return True
        except Exception as exc:
            logger.warning("Push notification failed", error=str(exc))
            return False

    @property
    def public_key(self) -> str:
        return settings.VAPID_PUBLIC_KEY


push_service = PushService()

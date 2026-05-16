from fastapi import APIRouter

from ..db import get_session
from ..models import PoolStats
from ..services.openrouter import model_status_snapshot
from ..services.pool import pool_counts

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/pool/stats", response_model=PoolStats)
def pool_stats() -> PoolStats:
    with get_session() as session:
        total, unused, by_domain = pool_counts(session)
    return PoolStats(total=total, unused=unused, by_domain=by_domain)


@router.get("/openrouter/status")
def openrouter_status() -> dict:
    """Per-model health + account-cap state. Useful for debugging refill failures."""
    return model_status_snapshot()

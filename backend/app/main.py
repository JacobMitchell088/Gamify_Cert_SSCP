import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import get_session, init_db
from .routers import health, runs
from .services.openrouter import maybe_refill_pool
from .services.pool import load_seed_if_empty

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_db()
    with get_session() as session:
        load_seed_if_empty(session)

    scheduler: AsyncIOScheduler | None = None
    if settings.openrouter_api_key and settings.free_model_list:
        scheduler = AsyncIOScheduler()
        scheduler.add_job(maybe_refill_pool, "interval", seconds=30, max_instances=1)
        scheduler.start()
        logger.info("openrouter refill scheduler started")
    else:
        logger.info("openrouter disabled (no API key or model list) — running on seed only")

    try:
        yield
    finally:
        if scheduler:
            scheduler.shutdown(wait=False)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="SSCP Gamify Backend", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(runs.router)
    return app


app = create_app()

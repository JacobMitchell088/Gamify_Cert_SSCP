from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings

_settings = get_settings()


def _ensure_sqlite_dir(url: str) -> None:
    if url.startswith("sqlite:///"):
        path = Path(url.replace("sqlite:///", "", 1))
        path.parent.mkdir(parents=True, exist_ok=True)


_ensure_sqlite_dir(_settings.database_url)

_is_sqlite = _settings.database_url.startswith("sqlite")
_is_postgres = "postgresql" in _settings.database_url

# Driver-specific connect args. For Supabase's Transaction Pooler (PgBouncer in
# tx mode), server-side prepared statements break — each tx may land on a
# different backend, so a "_pg3_N" prepared on backend A is missing on backend
# B → `InvalidSqlStatementName`. Setting prepare_threshold=None tells psycopg3
# to never prepare server-side, only client-side.
if _is_sqlite:
    _connect_args = {"check_same_thread": False}
elif _is_postgres:
    _connect_args = {"prepare_threshold": None}
else:
    _connect_args = {}

# pool_pre_ping issues a cheap SELECT 1 before handing out a pooled connection
# so we notice and replace any connection PgBouncer has silently closed.
_engine_kwargs = {"echo": False, "connect_args": _connect_args}
if _is_postgres:
    _engine_kwargs["pool_pre_ping"] = True

engine = create_engine(_settings.database_url, **_engine_kwargs)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Session:
    return Session(engine)

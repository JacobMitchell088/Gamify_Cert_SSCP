"""OpenRouter refill pipeline.

Design notes
------------
- OpenRouter's free tier shares a single account-wide cap of 50 requests/day
  (1000 with $10 prefunded). Racing N models in parallel burns N quota slots
  per refill cycle for the same 1 question of yield. So we go SERIAL with
  fallback instead of parallel-race, and we ask each call for a BATCH of
  questions so one quota slot yields many.
- We track three kinds of model state so the operator can see what's happening:
    healthy            — fine to call
    not_found          — OpenRouter says the slug doesn't exist; never call again
                         this process (operator must fix .env and restart)
    upstream_throttled — model-specific 429 (provider, not account-wide).
                         backs off for 1 hour
    account_cap        — account-wide free-tier cap. ALL models are paused
                         until next UTC midnight. Set globally, not per-model.
- Log lines are prefixed with [refill] / [probe] / [openrouter] and use
  key=value fields so they're greppable.
"""
from __future__ import annotations

import json
import logging
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

from ..config import get_settings
from ..db import get_session
from ..models import Domain
from .pool import insert_question, pool_counts
from .validator import validate_question

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# How many questions to request per API call. Each is validated and inserted
# independently; partial successes are kept.
QUESTIONS_PER_CALL = 5

# How long to back off after a model-specific upstream 429.
UPSTREAM_BACKOFF = timedelta(hours=1)

SYSTEM_PROMPT = (
    "You write practice questions for the (ISC)2 SSCP certification. "
    "Return STRICT JSON only — no prose, no markdown fences. "
    'Top-level schema: {"questions": [Question, Question, ...]} where each '
    'Question is {"stem": str, "options": [str, str, str, str], '
    '"correct_index": int (0-3), "explanation": str, "domain": str}. '
    "Exactly one option must be correct. Options must be plausible and distinct. "
    "Keep each stem under 500 chars."
)

DOMAIN_HINTS = {
    Domain.SECURITY_OPS: "Security Operations and Administration — policies, ethics, asset management.",
    Domain.ACCESS_CONTROLS: "Access Controls — authentication, authorization, identity management.",
    Domain.RISK: "Risk Identification, Monitoring, and Analysis — risk management, SIEM, metrics.",
    Domain.INCIDENT_RESPONSE: "Incident Response and Recovery — IR lifecycle, BCP/DRP, forensics basics.",
    Domain.CRYPTOGRAPHY: "Cryptography — symmetric/asymmetric, hashing, PKI, key management.",
    Domain.NETWORK: "Network and Communications Security — OSI, protocols, firewalls, segmentation.",
    Domain.SYS_APP_SECURITY: "Systems and Application Security — malware, endpoint, secure dev practices.",
}


# ---------------- Model state tracking ----------------

ModelStatus = str  # "healthy" | "not_found" | "upstream_throttled" | "unknown"


@dataclass
class ModelState:
    status: ModelStatus = "unknown"
    reason: str | None = None
    resume_at: datetime | None = None  # for time-bounded backoff
    last_success_at: datetime | None = None
    successes: int = 0
    failures: int = 0


# Per-process state. Cleared on restart.
_model_states: dict[str, ModelState] = {}
_account_cap_until: datetime | None = None  # global pause across all models


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _next_utc_midnight(after: datetime | None = None) -> datetime:
    base = after or _now()
    nxt = (base + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return nxt


def _state(model: str) -> ModelState:
    if model not in _model_states:
        _model_states[model] = ModelState(status="unknown")
    return _model_states[model]


def _is_account_cap_active() -> bool:
    return _account_cap_until is not None and _now() < _account_cap_until


def _model_callable(model: str) -> bool:
    """True if we should attempt a call against this model right now."""
    if _is_account_cap_active():
        return False
    st = _state(model)
    if st.status == "not_found":
        return False
    if st.resume_at and _now() < st.resume_at:
        return False
    # If the backoff has expired, clear it so subsequent successes look clean.
    if st.resume_at and _now() >= st.resume_at:
        st.status = "unknown"
        st.resume_at = None
        st.reason = None
    return True


def _mark_account_cap(triggered_by: str) -> None:
    global _account_cap_until
    target = _next_utc_midnight()
    # Only log a state change, not every repeat.
    if _account_cap_until != target:
        _account_cap_until = target
        logger.warning(
            "[openrouter] ACCOUNT_CAP_HIT triggered_by=%s pausing_until=%s",
            triggered_by, _account_cap_until.isoformat(),
        )


def _mark_not_found(model: str, body_preview: str) -> None:
    st = _state(model)
    if st.status != "not_found":
        logger.error(
            "[openrouter] MODEL_NOT_FOUND model=%s — will not be called again this process. "
            "Fix the slug in OPENROUTER_FREE_MODELS and restart. detail=%s",
            model, body_preview[:140],
        )
    st.status = "not_found"
    st.reason = body_preview[:200]
    st.resume_at = None


def _mark_upstream_throttle(model: str, body_preview: str) -> None:
    st = _state(model)
    st.status = "upstream_throttled"
    st.reason = body_preview[:200]
    st.resume_at = _now() + UPSTREAM_BACKOFF
    logger.warning(
        "[openrouter] UPSTREAM_THROTTLE model=%s resume_at=%s detail=%s",
        model, st.resume_at.isoformat(), body_preview[:140],
    )


def _mark_success(model: str) -> None:
    st = _state(model)
    st.status = "healthy"
    st.reason = None
    st.resume_at = None
    st.last_success_at = _now()
    st.successes += 1


def _mark_failure(model: str) -> None:
    _state(model).failures += 1


def model_status_snapshot() -> dict:
    """Public read-only view used by the /openrouter/status endpoint."""
    return {
        "account_cap_until": _account_cap_until.isoformat() if _account_cap_until else None,
        "account_cap_active": _is_account_cap_active(),
        "now": _now().isoformat(),
        "models": {
            m: {
                "status": s.status,
                "reason": s.reason,
                "resume_at": s.resume_at.isoformat() if s.resume_at else None,
                "last_success_at": s.last_success_at.isoformat() if s.last_success_at else None,
                "successes": s.successes,
                "failures": s.failures,
                "callable_now": _model_callable(m),
            }
            for m, s in _model_states.items()
        },
    }


def _log_status_summary(prefix: str) -> None:
    """One-line summary suitable for grepping."""
    parts = []
    for m, s in _model_states.items():
        tag = s.status
        if s.resume_at:
            tag += f"(until {s.resume_at.strftime('%H:%M')}Z)"
        parts.append(f"{m}={tag}")
    cap = f"account_cap_until={_account_cap_until.isoformat()}" if _account_cap_until else "account_cap=none"
    logger.info("[%s] status %s %s", prefix, cap, " ".join(parts) if parts else "(no models tracked yet)")


# ---------------- HTTP helpers ----------------

def _build_user_prompt(domain: Domain, n: int) -> str:
    return (
        f"Generate {n} DISTINCT SSCP exam-style multiple-choice questions for the domain '{domain.value}'. "
        f"Domain focus: {DOMAIN_HINTS[domain]} "
        f"Set the 'domain' field on every question to exactly: {domain.value}. "
        'Output only the JSON object {"questions": [...]}, with no surrounding prose. '
        "Do not duplicate stems."
    )


def _classify_error(status_code: int, body: str) -> str:
    """Return one of: account_cap, not_found, upstream_throttle, transient."""
    b = body.lower()
    if status_code == 429 and "free-models-per-day" in b:
        return "account_cap"
    if status_code == 404:
        return "not_found"
    # OpenRouter sometimes returns 400/404 with these signatures for bad slugs.
    if "no endpoints found" in b or "not a valid model" in b or '"code":404' in b:
        return "not_found"
    if status_code == 429:
        return "upstream_throttle"
    return "transient"


async def _call_model(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    domain: Domain,
    n_questions: int,
) -> list[dict] | None:
    """Single API call asking for N questions. Returns parsed list or None.

    Side effects: updates model state on classified errors.
    """
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(domain, n_questions)},
        ],
        "temperature": 0.8,
        "response_format": {"type": "json_object"},
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        r = await client.post(OPENROUTER_URL, json=payload, headers=headers, timeout=60.0)
    except httpx.RequestError as e:
        _mark_failure(model)
        logger.info("[refill] call model=%s network_error=%s", model, e)
        return None

    body_preview = r.text[:300].replace("\n", " ")

    if r.status_code != 200:
        kind = _classify_error(r.status_code, r.text)
        _mark_failure(model)
        if kind == "account_cap":
            _mark_account_cap(model)
        elif kind == "not_found":
            _mark_not_found(model, body_preview)
        elif kind == "upstream_throttle":
            _mark_upstream_throttle(model, body_preview)
        else:
            logger.info(
                "[refill] call model=%s http=%d transient_error=%s",
                model, r.status_code, body_preview[:140],
            )
        return None

    # 200 OK — parse content.
    try:
        data = r.json()
        choices = data.get("choices") or []
        if not choices:
            _mark_failure(model)
            logger.info("[refill] call model=%s http=200 empty_choices", model)
            return None
        content = choices[0].get("message", {}).get("content") or ""
        if not content.strip():
            _mark_failure(model)
            finish = choices[0].get("finish_reason")
            logger.info(
                "[refill] call model=%s http=200 empty_content finish_reason=%s",
                model, finish,
            )
            return None
        parsed = json.loads(content)
    except (ValueError, KeyError, TypeError) as e:
        _mark_failure(model)
        logger.info("[refill] call model=%s parse_error=%s body=%s", model, e, body_preview)
        return None

    # Accept either {"questions": [...]} or a bare list (some models drop the wrapper).
    if isinstance(parsed, dict) and "questions" in parsed:
        items = parsed["questions"]
    elif isinstance(parsed, list):
        items = parsed
    else:
        _mark_failure(model)
        logger.info(
            "[refill] call model=%s bad_shape keys=%s",
            model, list(parsed.keys()) if isinstance(parsed, dict) else type(parsed).__name__,
        )
        return None

    if not isinstance(items, list) or len(items) == 0:
        _mark_failure(model)
        logger.info("[refill] call model=%s zero_questions", model)
        return None

    return items


async def _fetch_questions_serial(domain: Domain) -> tuple[str | None, list[dict]]:
    """Walk active models one at a time, return first non-empty batch."""
    settings = get_settings()
    if not settings.openrouter_api_key or not settings.free_model_list:
        return None, []
    if _is_account_cap_active():
        return None, []

    async with httpx.AsyncClient() as client:
        for model in settings.free_model_list:
            if not _model_callable(model):
                continue
            items = await _call_model(
                client, settings.openrouter_api_key, model, domain, QUESTIONS_PER_CALL
            )
            if items:
                return model, items
            # If that call triggered the account cap, stop probing more models.
            if _is_account_cap_active():
                return None, []
    return None, []


# ---------------- Startup probe ----------------

async def probe_models() -> None:
    """One-shot health check at startup. Sends a tiny request per model;
    permanently disables anything OpenRouter says doesn't exist.

    Transient errors (429, 5xx, network) are tolerated — the refill loop
    will retry. Only `not_found` is sticky.
    """
    settings = get_settings()
    if not settings.openrouter_api_key or not settings.free_model_list:
        logger.info("[probe] skipped reason=no_api_key_or_models")
        return

    models = settings.free_model_list
    logger.info("[probe] start models=%d list=%s", len(models), ",".join(models))

    async with httpx.AsyncClient() as client:
        for model in models:
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 4,
            }
            headers = {"Authorization": f"Bearer {settings.openrouter_api_key}"}
            try:
                r = await client.post(OPENROUTER_URL, json=payload, headers=headers, timeout=20.0)
            except httpx.RequestError as e:
                logger.warning("[probe] model=%s result=network_error detail=%s (kept_enabled)", model, e)
                continue

            body_preview = r.text[:240].replace("\n", " ")

            if r.status_code == 200:
                _mark_success(model)
                logger.info("[probe] model=%s result=OK", model)
                continue

            kind = _classify_error(r.status_code, r.text)
            if kind == "account_cap":
                _mark_account_cap(f"probe:{model}")
                # All remaining models would also be cap-blocked; bail.
                logger.warning(
                    "[probe] model=%s result=account_cap_active — aborting remaining probes",
                    model,
                )
                break
            if kind == "not_found":
                _mark_not_found(model, body_preview)
                continue
            if kind == "upstream_throttle":
                _mark_upstream_throttle(model, body_preview)
                continue
            logger.warning(
                "[probe] model=%s result=transient http=%d detail=%s (kept_enabled)",
                model, r.status_code, body_preview[:140],
            )

    _log_status_summary("probe")


# ---------------- Public scheduler entry ----------------

async def maybe_refill_pool() -> None:
    settings = get_settings()
    with get_session() as session:
        total, unused, _ = pool_counts(session)
        if unused >= settings.pool_refill_threshold:
            return

        if _is_account_cap_active():
            logger.info(
                "[refill] skip reason=account_cap_active until=%s pool_total=%d unused=%d",
                _account_cap_until.isoformat() if _account_cap_until else "?",
                total, unused,
            )
            return

        active_models = [m for m in settings.free_model_list if _model_callable(m)]
        if not active_models:
            logger.warning(
                "[refill] skip reason=no_active_models total_configured=%d pool_total=%d unused=%d",
                len(settings.free_model_list), total, unused,
            )
            _log_status_summary("refill")
            return

        target_domain = random.choice(list(Domain))
        logger.info(
            "[refill] start domain=%s pool_total=%d unused=%d threshold=%d active_models=%s",
            target_domain.value, total, unused, settings.pool_refill_threshold,
            ",".join(active_models),
        )

        model_used, raw_items = await _fetch_questions_serial(target_domain)
        if not raw_items:
            logger.info("[refill] result=no_response_from_any_active_model")
            _log_status_summary("refill")
            return

        _mark_success(model_used)
        accepted = 0
        rejected = 0
        duplicates = 0
        for raw in raw_items:
            if not isinstance(raw, dict):
                rejected += 1
                continue
            raw.setdefault("source", f"openrouter:{model_used}")
            validated = validate_question(raw)
            if validated is None:
                rejected += 1
                continue
            if insert_question(session, validated):
                accepted += 1
            else:
                duplicates += 1
        logger.info(
            "[refill] result=ok model=%s domain=%s requested=%d accepted=%d rejected=%d duplicates=%d",
            model_used, target_domain.value, QUESTIONS_PER_CALL, accepted, rejected, duplicates,
        )

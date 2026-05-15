import asyncio
import json
import logging
import random

import httpx

from ..config import get_settings
from ..db import get_session
from ..models import Domain
from .pool import insert_question, pool_counts
from .validator import validate_question

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = (
    "You write practice questions for the (ISC)2 SSCP certification. "
    "Return STRICT JSON only — no prose, no markdown fences. "
    "Schema: {\"stem\": str, \"options\": [str, str, str, str], "
    "\"correct_index\": int (0-3), \"explanation\": str, \"domain\": str}. "
    "Exactly one option must be correct. Options must be plausible and distinct. "
    "Keep stem under 500 chars."
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


def _build_user_prompt(domain: Domain) -> str:
    return (
        f"Generate ONE SSCP exam-style multiple-choice question for the domain '{domain.value}'. "
        f"Domain focus: {DOMAIN_HINTS[domain]} "
        f"Set the 'domain' field to exactly: {domain.value}. "
        "Output only the JSON object."
    )


async def _call_one(client: httpx.AsyncClient, api_key: str, model: str, domain: Domain) -> dict | None:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(domain)},
        ],
        "temperature": 0.8,
        "response_format": {"type": "json_object"},
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        r = await client.post(OPENROUTER_URL, json=payload, headers=headers, timeout=30.0)
        r.raise_for_status()
        data = r.json()
        content = data["choices"][0]["message"]["content"]
        return {"_model": model, **json.loads(content)}
    except Exception as e:
        logger.debug("openrouter call failed (%s): %s", model, e)
        return None


async def race_one_question(domain: Domain) -> dict | None:
    settings = get_settings()
    if not settings.openrouter_api_key or not settings.free_model_list:
        return None

    async with httpx.AsyncClient() as client:
        tasks = [
            asyncio.create_task(_call_one(client, settings.openrouter_api_key, m, domain))
            for m in settings.free_model_list
        ]
        try:
            while tasks:
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    result = task.result()
                    if result is not None:
                        for p in pending:
                            p.cancel()
                        return result
                tasks = list(pending)
        finally:
            for t in tasks:
                t.cancel()
    return None


async def maybe_refill_pool() -> None:
    settings = get_settings()
    with get_session() as session:
        total, unused, _ = pool_counts(session)
        if unused >= settings.pool_refill_threshold:
            return

        target_domain = random.choice(list(Domain))
        raw = await race_one_question(target_domain)
        if raw is None:
            logger.info("refill: no model returned a valid response this round")
            return

        winning_model = raw.pop("_model", "unknown")
        raw.setdefault("source", f"openrouter:{winning_model}")
        validated = validate_question(raw)
        if validated is None:
            logger.info("refill: response rejected by schema (model=%s)", winning_model)
            return

        ok = insert_question(session, validated)
        if ok:
            logger.info("refill: +1 question from %s (domain=%s)", winning_model, validated.domain)

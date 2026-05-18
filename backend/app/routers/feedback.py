import logging

import httpx
from fastapi import APIRouter, HTTPException, Request

from ..config import get_settings
from ..models import FeedbackIn

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/feedback", tags=["feedback"])

GITHUB_API = "https://api.github.com"
MAX_UA_LEN = 400


@router.post("")
async def submit_feedback(payload: FeedbackIn, request: Request) -> dict:
    settings = get_settings()
    if not settings.github_token or not settings.github_repo:
        raise HTTPException(
            status_code=503,
            detail="Feedback is not configured on this server.",
        )

    ua = request.headers.get("user-agent") or ""
    if len(ua) > MAX_UA_LEN:
        ua = ua[:MAX_UA_LEN]

    title = _title_from(payload)
    body = _body_from(payload, ua)
    labels = settings.github_label_list + [f"category:{payload.category}"]

    url = f"{GITHUB_API}/repos/{settings.github_repo}/issues"
    headers = {
        "Authorization": f"Bearer {settings.github_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    json_payload = {"title": title, "body": body, "labels": labels}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(url, headers=headers, json=json_payload)
    except httpx.HTTPError as exc:
        logger.exception("[feedback] github request failed")
        raise HTTPException(status_code=502, detail="Could not reach GitHub.") from exc

    if r.status_code >= 300:
        logger.warning("[feedback] github responded %s body=%s", r.status_code, r.text[:400])
        raise HTTPException(
            status_code=502,
            detail=f"GitHub rejected the feedback ({r.status_code}).",
        )

    data = r.json()
    issue_number = data.get("number")
    issue_url = data.get("html_url")
    logger.info(
        "[feedback] issue created number=%s category=%s contact=%s",
        issue_number,
        payload.category,
        bool(payload.contact),
    )
    return {"ok": True, "issue_number": issue_number, "issue_url": issue_url}


def _title_from(p: FeedbackIn) -> str:
    snippet = p.message.strip().splitlines()[0][:80]
    return f"[{p.category}] {snippet}"


def _body_from(p: FeedbackIn, user_agent: str) -> str:
    lines = [
        "_Submitted via the in-game Feedback button._",
        "",
        "### Message",
        p.message.strip(),
        "",
        "### Metadata",
        f"- **Category:** {p.category}",
        f"- **Contact:** {p.contact or '_(not provided)_'}",
        f"- **Page:** {p.page or '_(unknown)_'}",
        f"- **User agent:** `{user_agent or 'unknown'}`",
    ]
    return "\n".join(lines)

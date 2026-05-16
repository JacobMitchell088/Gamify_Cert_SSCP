import json
import logging
import time

from fastapi import APIRouter, HTTPException, Request

from ..db import get_session
from ..models import QuestionReport, ReportIn
from ..services.pool import get_question

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/question", tags=["reports"])

MAX_UA_LEN = 400


@router.post("/{question_id}/report")
def report_question(question_id: int, payload: ReportIn, request: Request) -> dict:
    with get_session() as session:
        q = get_question(session, question_id)
        if not q:
            raise HTTPException(status_code=404, detail="question not found")

        ua = request.headers.get("user-agent") or None
        if ua and len(ua) > MAX_UA_LEN:
            ua = ua[:MAX_UA_LEN]

        report = QuestionReport(
            question_id=question_id,
            reason=payload.reason.strip(),
            stem_snapshot=q.stem,
            options_snapshot=json.dumps(
                [q.option_a, q.option_b, q.option_c, q.option_d]
            ),
            correct_index_snapshot=q.correct_index,
            had_answered=payload.had_answered,
            player_pick=payload.player_pick,
            user_agent=ua,
            created_at=time.time(),
        )
        session.add(report)
        session.commit()
        session.refresh(report)

        logger.info(
            "question_report id=%s qid=%s answered=%s pick=%s",
            report.id,
            question_id,
            payload.had_answered,
            payload.player_pick,
        )
        return {"ok": True, "report_id": report.id}

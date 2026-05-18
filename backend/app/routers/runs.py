import time

from fastapi import APIRouter, HTTPException
from sqlmodel import select

from ..config import get_settings
from ..db import get_session
from ..models import AnswerIn, AnswerOut, BatchOut, Run, RunQuestion
from ..services.games import BATCH_SIZE, game_for_batch
from ..services.pool import get_question, reserve_batch

router = APIRouter(prefix="/run")


def _build_batch(session, run: Run, batch_index: int) -> BatchOut:
    questions = reserve_batch(session, BATCH_SIZE)
    if not questions:
        raise HTTPException(status_code=503, detail="question pool empty")

    base_position = batch_index * BATCH_SIZE
    for offset, q in enumerate(questions):
        session.add(
            RunQuestion(
                run_id=run.id,
                position=base_position + offset,
                question_id=q.id,
            )
        )
    run.question_count = base_position + len(questions)
    session.add(run)
    session.commit()

    reveal = get_settings().dev_reveal_answers
    return BatchOut(
        run_id=run.id,
        batch_index=batch_index,
        game_key=game_for_batch(batch_index),
        questions=[q.to_out(reveal_correct=reveal) for q in questions],
        # Runs are open-ended: each game's scene decides when to end (e.g.
        # tower-defense core dies, RPG hero or boss falls). The backend keeps
        # serving batches as long as the pool can fill them.
        is_final=False,
    )


@router.post("/start", response_model=BatchOut)
def start_run() -> BatchOut:
    with get_session() as session:
        run = Run(started_at=time.time())
        session.add(run)
        session.commit()
        session.refresh(run)
        return _build_batch(session, run, 0)


@router.get("/{run_id}/next-batch", response_model=BatchOut)
def next_batch(run_id: int) -> BatchOut:
    with get_session() as session:
        run = session.get(Run, run_id)
        if not run:
            raise HTTPException(status_code=404, detail="run not found")
        if run.finished:
            raise HTTPException(status_code=400, detail="run already finished")

        served = session.exec(
            select(RunQuestion).where(RunQuestion.run_id == run_id)
        ).all()
        batch_index = len(served) // BATCH_SIZE
        return _build_batch(session, run, batch_index)


@router.post("/{run_id}/answer", response_model=AnswerOut)
def submit_answer(run_id: int, payload: AnswerIn) -> AnswerOut:
    with get_session() as session:
        run = session.get(Run, run_id)
        if not run:
            raise HTTPException(status_code=404, detail="run not found")

        q = get_question(session, payload.question_id)
        if not q:
            raise HTTPException(status_code=404, detail="question not found")

        rq = session.exec(
            select(RunQuestion)
            .where(RunQuestion.run_id == run_id)
            .where(RunQuestion.question_id == payload.question_id)
        ).first()
        if not rq:
            raise HTTPException(status_code=400, detail="question not part of this run")

        correct = payload.chosen_index == q.correct_index
        rq.answered_index = payload.chosen_index
        rq.correct = correct
        session.add(rq)
        if correct:
            run.correct_count += 1
            session.add(run)
        session.commit()

        return AnswerOut(
            correct=correct,
            correct_index=q.correct_index,
            explanation=q.explanation,
        )


@router.post("/{run_id}/finish")
def finish_run(run_id: int) -> dict:
    with get_session() as session:
        run = session.get(Run, run_id)
        if not run:
            raise HTTPException(status_code=404, detail="run not found")
        run.finished = True
        session.add(run)
        session.commit()
        return {
            "run_id": run_id,
            "question_count": run.question_count,
            "correct_count": run.correct_count,
        }

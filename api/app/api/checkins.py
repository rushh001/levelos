from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import current_teacher
from ..db import get_db
from ..llm import diagnose as diag
from ..models import Teacher
from ..serialize import checkin_out, item_result_out
from ..services import checkins as svc

router = APIRouter(prefix="/api/checkins", tags=["checkins"])

MAX_AUDIO_BYTES = 10 * 1024 * 1024
_SUFFIX = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a",
           "audio/aac": ".aac", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav",
           "audio/mpeg": ".mp3", "audio/3gpp": ".3gp", "audio/amr": ".amr"}


class StartIn(BaseModel):
    student_id: str
    language: str | None = None
    local_id: str | None = Field(default=None, max_length=64)
    start_level: str | None = None  # offline check-ins only: the rung the phone's ladder started on


class MarksIn(BaseModel):
    item_id: str
    marks: list[bool] = Field(min_length=1, max_length=200)
    duration_ms: int | None = Field(default=None, ge=0)


class WordMark(BaseModel):
    item_result_id: str
    i: int = Field(ge=0)
    correct: bool


class ReviewIn(BaseModel):
    marks: list[WordMark] = Field(min_length=1)


class OverrideIn(BaseModel):
    level: str | None  # None clears the override


def _diagnose(db: Session, c, background: BackgroundTasks) -> None:
    """Rule-based diagnosis now; Claude's replaces it in the background when the evidence changed."""
    if c.status in ("scored", "needs_review"):
        changed = diag.refresh_rules(db, c)
        if changed:
            background.add_task(diag.run_claude, c.id, changed)


def _suffix(upload: UploadFile) -> str:
    ctype = (upload.content_type or "").split(";")[0].strip().lower()
    if ctype in _SUFFIX:
        return _SUFFIX[ctype]
    name = upload.filename or ""
    return name[name.rfind("."):].lower() if "." in name else ".webm"


@router.post("", status_code=201)
def start(body: StartIn, teacher: Teacher = Depends(current_teacher), db: Session = Depends(get_db)) -> dict:
    c = svc.start(db, teacher, body.student_id, body.language, body.local_id, body.start_level)
    return checkin_out(c, svc.next_item(db, c))


@router.get("/{checkin_id}")
def get(checkin_id: str, teacher: Teacher = Depends(current_teacher), db: Session = Depends(get_db)) -> dict:
    c = svc.owned_checkin(db, teacher, checkin_id)
    return checkin_out(c, svc.next_item(db, c))


@router.post("/{checkin_id}/items")
async def upload_item(checkin_id: str, item_id: str = Form(...), audio: UploadFile = File(...),
                      teacher: Teacher = Depends(current_teacher), db: Session = Depends(get_db)) -> dict:
    """Score one recorded item. `status` is scored, rerecord (same item again: too short / silent / too long)
    or failed (speech services down: fall back to tap-to-mark)."""
    c = svc.owned_checkin(db, teacher, checkin_id)
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "clip too large")
    score, ir = await svc.add_audio(db, c, item_id, data, _suffix(audio))
    return {
        "status": score.status,
        "reason": score.reason,
        "item_result": item_result_out(ir) if ir else None,
        "checkin": checkin_out(c, svc.next_item(db, c)),
    }


@router.post("/{checkin_id}/marks")
def mark_item(checkin_id: str, body: MarksIn, teacher: Teacher = Depends(current_teacher),
              db: Session = Depends(get_db)) -> dict:
    c = svc.owned_checkin(db, teacher, checkin_id)
    ir = svc.add_marks(db, c, body.item_id, body.marks, body.duration_ms)
    return {"status": "scored", "reason": None, "item_result": item_result_out(ir),
            "checkin": checkin_out(c, svc.next_item(db, c))}


@router.post("/{checkin_id}/items/{item_result_id}/audio")
async def attach_audio(checkin_id: str, item_result_id: str, background: BackgroundTasks,
                       audio: UploadFile = File(...), teacher: Teacher = Depends(current_teacher),
                       db: Session = Depends(get_db)) -> dict:
    """Recording of an item that was tap-marked offline: AI-score it; disagreements with the marks become
    uncertain words for the teacher."""
    c = svc.owned_checkin(db, teacher, checkin_id)
    ir = next((r for r in c.items if r.id == item_result_id), None)
    if ir is None:
        raise HTTPException(404, "item result not found")
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "clip too large")
    await svc.attach_audio(db, c, ir, data, _suffix(audio))
    _diagnose(db, c, background)
    return checkin_out(c, svc.next_item(db, c))


@router.get("/{checkin_id}/items/{item_result_id}/audio")
def play_audio(checkin_id: str, item_result_id: str, teacher: Teacher = Depends(current_teacher),
               db: Session = Depends(get_db)) -> Response:
    """The child's recording of one item, for the teacher to listen again. Only the class's own teacher can."""
    c = svc.owned_checkin(db, teacher, checkin_id)
    ir = next((r for r in c.items if r.id == item_result_id), None)
    if ir is None or ir.audio is None:
        raise HTTPException(404, "no recording (never made, or deleted after the retention period)")
    return Response(content=ir.audio.data, media_type=ir.audio.mime,
                    headers={"Cache-Control": "private, max-age=86400"})


@router.delete("/{checkin_id}/audio")
def delete_audio(checkin_id: str, teacher: Teacher = Depends(current_teacher), db: Session = Depends(get_db)) -> dict:
    """Teacher deletes every recording of this check-in (the scores and diagnosis stay)."""
    c = svc.owned_checkin(db, teacher, checkin_id)
    svc.delete_audio(db, c)
    return checkin_out(svc.owned_checkin(db, teacher, checkin_id), svc.next_item(db, c))


@router.post("/{checkin_id}/finish")
def finish(checkin_id: str, background: BackgroundTasks, teacher: Teacher = Depends(current_teacher),
           db: Session = Depends(get_db)) -> dict:
    c = svc.finish(db, svc.owned_checkin(db, teacher, checkin_id))
    _diagnose(db, c, background)
    return checkin_out(c)


@router.post("/{checkin_id}/review")
def review(checkin_id: str, body: ReviewIn, background: BackgroundTasks, teacher: Teacher = Depends(current_teacher),
           db: Session = Depends(get_db)) -> dict:
    c = svc.owned_checkin(db, teacher, checkin_id)
    svc.review(db, c, [(m.item_result_id, m.i, m.correct) for m in body.marks])
    _diagnose(db, c, background)
    return checkin_out(c, svc.next_item(db, c))


@router.post("/{checkin_id}/override")
def override(checkin_id: str, body: OverrideIn, background: BackgroundTasks,
             teacher: Teacher = Depends(current_teacher), db: Session = Depends(get_db)) -> dict:
    c = svc.override(db, svc.owned_checkin(db, teacher, checkin_id), body.level)
    _diagnose(db, c, background)
    return checkin_out(c)


@router.post("/{checkin_id}/abandon")
def abandon(checkin_id: str, teacher: Teacher = Depends(current_teacher), db: Session = Depends(get_db)) -> dict:
    c = svc.owned_checkin(db, teacher, checkin_id)
    if c.status == "in_progress":
        c.status = "abandoned"
        db.commit()
    return checkin_out(c)

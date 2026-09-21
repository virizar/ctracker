from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.models import ProcessedEvent, ScaleWeight, UserProfile
from app.db.session import get_db
from app.services.auth import get_current_user
from app.services.tdee import recalculate_user_tdee

router = APIRouter(prefix="/v1/weight", tags=["Scale Weight"])


class WeightLogRequest(BaseModel):
    date: str = Field(description="Date in YYYY-MM-DD format")
    raw_weight: float = Field(description="Scale weight in kg")
    client_event_id: str | None = Field(default=None, description="Idempotency key for offline retries")


class WeightLogResponse(BaseModel):
    id: int
    date: str
    raw_weight: float
    trend_weight: float | None


@router.post("", response_model=WeightLogResponse, status_code=status.HTTP_200_OK)
def log_scale_weight(
    req: WeightLogRequest, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)
):
    # Idempotency Check
    if req.client_event_id:
        existing_event = db.query(ProcessedEvent).filter(ProcessedEvent.client_event_id == req.client_event_id).first()
        if existing_event:
            # Event already processed successfully
            w_obj = (
                db.query(ScaleWeight)
                .filter(ScaleWeight.username == user.username, ScaleWeight.date == req.date)
                .first()
            )
            if w_obj:
                return WeightLogResponse(
                    id=w_obj.id, date=w_obj.date, raw_weight=w_obj.raw_weight, trend_weight=w_obj.trend_weight
                )

    # Upsert ScaleWeight
    w_obj = db.query(ScaleWeight).filter(ScaleWeight.username == user.username, ScaleWeight.date == req.date).first()
    if not w_obj:
        w_obj = ScaleWeight(
            username=user.username, date=req.date, raw_weight=req.raw_weight, client_event_id=req.client_event_id
        )
        db.add(w_obj)
    else:
        w_obj.raw_weight = req.raw_weight
        w_obj.client_event_id = req.client_event_id

    # Record Processed Event
    if req.client_event_id:
        p_event = ProcessedEvent(client_event_id=req.client_event_id, endpoint="/v1/weight")
        db.add(p_event)

    db.commit()
    db.refresh(w_obj)

    # Recalculate TDEE & trend weights
    recalculate_user_tdee(db, user.username)
    db.refresh(w_obj)

    return WeightLogResponse(id=w_obj.id, date=w_obj.date, raw_weight=w_obj.raw_weight, trend_weight=w_obj.trend_weight)


@router.get("", response_model=list[WeightLogResponse])
def get_weight_history(
    start_date: str | None = None,
    end_date: str | None = None,
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ScaleWeight).filter(ScaleWeight.username == user.username)
    if start_date:
        query = query.filter(ScaleWeight.date >= start_date)
    if end_date:
        query = query.filter(ScaleWeight.date <= end_date)

    records = query.order_by(ScaleWeight.date.asc()).all()
    return [
        WeightLogResponse(id=r.id, date=r.date, raw_weight=r.raw_weight, trend_weight=r.trend_weight) for r in records
    ]


@router.delete("/{date}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scale_weight(date: str, user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)):
    w_obj = db.query(ScaleWeight).filter(ScaleWeight.username == user.username, ScaleWeight.date == date).first()
    if not w_obj:
        raise HTTPException(status_code=404, detail=f"No weight log found for date {date}")

    db.delete(w_obj)
    db.commit()

    recalculate_user_tdee(db, user.username)

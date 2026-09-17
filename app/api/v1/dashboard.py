from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.db.models import UserProfile, DailySummary
from app.services.auth import get_current_user

router = APIRouter(prefix="/v1/dashboard", tags=["Dashboard & Trends"])

class DailySummaryResponse(BaseModel):
    date: str
    total_calories: float
    total_protein: float
    total_carbs: float
    total_fat: float
    raw_weight: Optional[float]
    trend_weight: Optional[float]
    tdee: Optional[float]
    target_calories: Optional[float]
    protein_target_g: float
    carbs_target_g: float
    fat_target_g: float

class TrendPoint(BaseModel):
    date: str
    raw_weight: Optional[float]
    trend_weight: Optional[float]
    total_calories: float
    tdee: Optional[float]
    target_calories: Optional[float]

@router.get("/summary", response_model=DailySummaryResponse)
def get_daily_summary(
    date: Optional[str] = Query(default=None, description="Date in YYYY-MM-DD format (defaults to today)"),
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    target_date = date or datetime.utcnow().strftime("%Y-%m-%d")
    
    summary = db.query(DailySummary).filter(
        DailySummary.username == user.username,
        DailySummary.date == target_date
    ).first()

    total_cals = summary.total_calories if summary else 0.0
    total_p = summary.total_protein if summary else 0.0
    total_c = summary.total_carbs if summary else 0.0
    total_f = summary.total_fat if summary else 0.0

    raw_w = summary.raw_weight if summary else None
    trend_w = summary.trend_weight if summary else None
    tdee_val = summary.tdee if summary else 2500.0
    target_cals = summary.target_calories if summary else 2000.0

    # Calculate macro targets based on target calories and profile ratios
    # Protein: 4 kcal/g, Carbs: 4 kcal/g, Fat: 9 kcal/g
    p_target_g = (target_cals * user.protein_ratio) / 4.0
    c_target_g = (target_cals * user.carbs_ratio) / 4.0
    f_target_g = (target_cals * user.fat_ratio) / 9.0

    return DailySummaryResponse(
        date=target_date,
        total_calories=round(total_cals, 1),
        total_protein=round(total_p, 1),
        total_carbs=round(total_c, 1),
        total_fat=round(total_f, 1),
        raw_weight=raw_w,
        trend_weight=trend_w,
        tdee=tdee_val,
        target_calories=target_cals,
        protein_target_g=round(p_target_g, 1),
        carbs_target_g=round(c_target_g, 1),
        fat_target_g=round(f_target_g, 1)
    )

@router.get("/trends", response_model=List[TrendPoint])
def get_dashboard_trends(
    days: int = Query(default=30, ge=7, le=1000, description="Number of historical days to fetch"),
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    end_dt = datetime.utcnow()
    start_dt = end_dt - timedelta(days=days)
    start_str = start_dt.strftime("%Y-%m-%d")

    records = db.query(DailySummary).filter(
        DailySummary.username == user.username,
        DailySummary.date >= start_str
    ).order_by(DailySummary.date.asc()).all()

    return [
        TrendPoint(
            date=r.date,
            raw_weight=r.raw_weight,
            trend_weight=r.trend_weight,
            total_calories=r.total_calories,
            tdee=r.tdee,
            target_calories=r.target_calories
        )
        for r in records
    ]

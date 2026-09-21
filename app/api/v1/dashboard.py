from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.db.models import DailySummary, UserProfile
from app.db.session import get_db
from app.services.auth import get_current_user

router = APIRouter(prefix="/v1/dashboard", tags=["Dashboard & Trends"])


class DailySummaryResponse(BaseModel):
    date: str
    total_calories: float
    total_protein: float
    total_carbs: float
    total_fat: float
    raw_weight: float | None
    trend_weight: float | None
    tdee: float | None
    target_calories: float | None
    protein_target_g: float
    carbs_target_g: float
    fat_target_g: float
    target_weight_kg: float | None
    target_monthly_rate_kg: float
    min_daily_calories: float
    is_rate_capped_by_safety_floor: bool
    projected_date_target_rate: str | None
    projected_date_actual_rate: str | None
    actual_monthly_rate_kg: float | None


class TrendPoint(BaseModel):
    date: str
    raw_weight: float | None
    trend_weight: float | None
    total_calories: float
    tdee: float | None
    target_calories: float | None


@router.get("/summary", response_model=DailySummaryResponse)
def get_daily_summary(
    date: str | None = Query(default=None, description="Date in YYYY-MM-DD format (defaults to today)"),
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_date = date or datetime.now(UTC).strftime("%Y-%m-%d")
    target_dt = datetime.strptime(target_date, "%Y-%m-%d")

    summary = (
        db.query(DailySummary).filter(DailySummary.username == user.username, DailySummary.date == target_date).first()
    )

    total_cals = summary.total_calories if summary else 0.0
    total_p = summary.total_protein if summary else 0.0
    total_c = summary.total_carbs if summary else 0.0
    total_f = summary.total_fat if summary else 0.0

    raw_w = summary.raw_weight if summary else None
    trend_w = summary.trend_weight if summary else None
    tdee_val = summary.tdee if summary else 2500.0
    target_cals = summary.target_calories if summary else 2000.0
    is_capped = summary.is_rate_capped_by_safety_floor if summary else False

    # Macro Targets
    p_target_g = (target_cals * user.protein_ratio) / 4.0
    c_target_g = (target_cals * user.carbs_ratio) / 4.0
    f_target_g = (target_cals * user.fat_ratio) / 9.0

    # Dual Goal Projections Math
    proj_target_date_str = None
    proj_actual_date_str = None
    actual_monthly_rate = None

    if trend_w and user.target_weight_kg:
        remaining_kg = trend_w - user.target_weight_kg

        # 1. Target Rate Projection
        if remaining_kg > 0 and user.target_monthly_rate_kg < 0:
            daily_target_loss = abs(user.target_monthly_rate_kg) / settings.DAYS_PER_MONTH
            days_needed_target = int(remaining_kg / daily_target_loss)
            proj_target_date_str = (target_dt + timedelta(days=days_needed_target)).strftime("%Y-%m-%d")

        # 2. Actual 30d Trend Rate Projection
        past_date_30d = (target_dt - timedelta(days=30)).strftime("%Y-%m-%d")
        past_summary = (
            db.query(DailySummary)
            .filter(DailySummary.username == user.username, DailySummary.date == past_date_30d)
            .first()
        )

        if past_summary and past_summary.trend_weight:
            actual_loss_30d = past_summary.trend_weight - trend_w
            actual_daily_loss = actual_loss_30d / 30.0
            actual_monthly_rate = round(actual_daily_loss * settings.DAYS_PER_MONTH, 2)

            if remaining_kg > 0 and actual_daily_loss > 0:
                days_needed_actual = int(remaining_kg / actual_daily_loss)
                proj_actual_date_str = (target_dt + timedelta(days=days_needed_actual)).strftime("%Y-%m-%d")

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
        fat_target_g=round(f_target_g, 1),
        target_weight_kg=user.target_weight_kg,
        target_monthly_rate_kg=user.target_monthly_rate_kg,
        min_daily_calories=user.min_daily_calories,
        is_rate_capped_by_safety_floor=is_capped,
        projected_date_target_rate=proj_target_date_str,
        projected_date_actual_rate=proj_actual_date_str,
        actual_monthly_rate_kg=actual_monthly_rate,
    )


@router.get("/trends", response_model=list[TrendPoint])
def get_dashboard_trends(
    days: int = Query(default=30, ge=7, le=1000, description="Number of historical days to fetch"),
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    end_dt = datetime.now(UTC)
    start_dt = end_dt - timedelta(days=days)
    start_str = start_dt.strftime("%Y-%m-%d")

    records = (
        db.query(DailySummary)
        .filter(DailySummary.username == user.username, DailySummary.date >= start_str)
        .order_by(DailySummary.date.asc())
        .all()
    )

    return [
        TrendPoint(
            date=r.date,
            raw_weight=r.raw_weight,
            trend_weight=r.trend_weight,
            total_calories=r.total_calories,
            tdee=r.tdee,
            target_calories=r.target_calories,
        )
        for r in records
    ]

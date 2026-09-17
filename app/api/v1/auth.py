from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from datetime import datetime
from app.db.session import get_db
from app.db.models import UserProfile
from app.services.auth import get_current_user
from app.services.tdee import mifflin_st_jeor, calculate_age_years, recalculate_user_tdee

router = APIRouter(prefix="/v1/auth", tags=["Auth & Profile"])

class ProfileResponse(BaseModel):
    username: str
    dob: str
    height_cm: float
    sex: str
    activity_multiplier: float
    target_rate_kg_per_week: float
    protein_ratio: float
    carbs_ratio: float
    fat_ratio: float
    estimated_bmr: float

class ProfileUpdateRequest(BaseModel):
    dob: Optional[str] = None
    height_cm: Optional[float] = None
    sex: Optional[str] = None
    activity_multiplier: Optional[float] = None
    target_rate_kg_per_week: Optional[float] = None
    protein_ratio: Optional[float] = None
    carbs_ratio: Optional[float] = None
    fat_ratio: Optional[float] = None

@router.get("/me", response_model=ProfileResponse)
def get_user_profile(user: UserProfile = Depends(get_current_user)):
    age_yr = calculate_age_years(user.dob, datetime.utcnow().strftime("%Y-%m-%d"))
    bmr = mifflin_st_jeor(80.0, user.height_cm, age_yr, user.sex)
    return ProfileResponse(
        username=user.username,
        dob=user.dob,
        height_cm=user.height_cm,
        sex=user.sex,
        activity_multiplier=user.activity_multiplier,
        target_rate_kg_per_week=user.target_rate_kg_per_week,
        protein_ratio=user.protein_ratio,
        carbs_ratio=user.carbs_ratio,
        fat_ratio=user.fat_ratio,
        estimated_bmr=round(bmr, 1)
    )

@router.patch("/me", response_model=ProfileResponse)
def update_user_profile(
    req: ProfileUpdateRequest,
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if req.dob is not None:
        user.dob = req.dob
    if req.height_cm is not None:
        user.height_cm = req.height_cm
    if req.sex is not None:
        user.sex = req.sex
    if req.activity_multiplier is not None:
        user.activity_multiplier = req.activity_multiplier
    if req.target_rate_kg_per_week is not None:
        user.target_rate_kg_per_week = req.target_rate_kg_per_week
    if req.protein_ratio is not None:
        user.protein_ratio = req.protein_ratio
    if req.carbs_ratio is not None:
        user.carbs_ratio = req.carbs_ratio
    if req.fat_ratio is not None:
        user.fat_ratio = req.fat_ratio

    db.commit()
    db.refresh(user)

    # Recalculate TDEE & daily targets with updated profile settings
    recalculate_user_tdee(db, user.username)

    age_yr = calculate_age_years(user.dob, datetime.utcnow().strftime("%Y-%m-%d"))
    bmr = mifflin_st_jeor(80.0, user.height_cm, age_yr, user.sex)
    return ProfileResponse(
        username=user.username,
        dob=user.dob,
        height_cm=user.height_cm,
        sex=user.sex,
        activity_multiplier=user.activity_multiplier,
        target_rate_kg_per_week=user.target_rate_kg_per_week,
        protein_ratio=user.protein_ratio,
        carbs_ratio=user.carbs_ratio,
        fat_ratio=user.fat_ratio,
        estimated_bmr=round(bmr, 1)
    )

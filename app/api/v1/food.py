import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import List, Optional
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.db.models import UserProfile, MealLog, ProcessedEvent
from app.services.auth import get_current_user
from app.services.gemini import parse_meal_text_with_gemini
from app.services.tdee import recalculate_user_tdee

router = APIRouter(prefix="/v1/food", tags=["Food & Meals"])

class InterpretTextRequest(BaseModel):
    text: str = Field(description="Natural language description of meal")
    date: Optional[str] = Field(default=None, description="Date in YYYY-MM-DD format (defaults to today)")
    client_event_id: Optional[str] = Field(default=None, description="Idempotency key for offline retries")

class MealCreateRequest(BaseModel):
    date: str = Field(description="Date in YYYY-MM-DD format")
    time: Optional[str] = Field(default=None, description="Time e.g. 12:30 PM")
    food_name: str
    serving_size: Optional[str] = "1 serving"
    serving_qty: float = 1.0
    serving_weight_g: Optional[float] = None
    calories: float
    protein: float = 0.0
    carbs: float = 0.0
    fat: float = 0.0
    is_fasted: bool = False
    client_event_id: Optional[str] = None

class MealResponse(BaseModel):
    id: str
    date: str
    time: Optional[str]
    food_name: str
    serving_size: Optional[str]
    serving_qty: float
    serving_weight_g: Optional[float]
    calories: float
    protein: float
    carbs: float
    fat: float
    is_fasted: bool

class InterpretResponse(BaseModel):
    summary: str
    logged_meals: List[MealResponse]

@router.post("/interpret", response_model=InterpretResponse)
async def interpret_and_log_meal(
    req: InterpretTextRequest,
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    target_date = req.date or datetime.utcnow().strftime("%Y-%m-%d")

    # Idempotency Check
    if req.client_event_id:
        existing_event = db.query(ProcessedEvent).filter(ProcessedEvent.client_event_id == req.client_event_id).first()
        if existing_event:
            meals = db.query(MealLog).filter(MealLog.username == user.username, MealLog.client_event_id == req.client_event_id).all()
            return InterpretResponse(
                summary="Retrieved previously processed meal interpretation",
                logged_meals=[
                    MealResponse(
                        id=m.id, date=m.date, time=m.time, food_name=m.food_name,
                        serving_size=m.serving_size, serving_qty=m.serving_qty,
                        serving_weight_g=m.serving_weight_g, calories=m.calories,
                        protein=m.protein, carbs=m.carbs, fat=m.fat, is_fasted=m.is_fasted
                    ) for m in meals
                ]
            )

    parsed = await parse_meal_text_with_gemini(req.text)
    logged_objs = []

    for item in parsed.foods:
        meal = MealLog(
            id=str(uuid.uuid4()),
            username=user.username,
            date=target_date,
            time=datetime.utcnow().strftime("%I:%M %p"),
            food_name=item.food_name,
            serving_size=item.serving_size,
            serving_qty=item.serving_qty,
            serving_weight_g=item.serving_weight_g,
            calories=item.calories,
            protein=item.protein,
            carbs=item.carbs,
            fat=item.fat,
            client_event_id=req.client_event_id
        )
        db.add(meal)
        logged_objs.append(meal)

    if req.client_event_id:
        db.add(ProcessedEvent(client_event_id=req.client_event_id, endpoint="/v1/food/interpret"))

    db.commit()
    for m in logged_objs:
        db.refresh(m)

    recalculate_user_tdee(db, user.username)

    return InterpretResponse(
        summary=parsed.summary,
        logged_meals=[
            MealResponse(
                id=m.id, date=m.date, time=m.time, food_name=m.food_name,
                serving_size=m.serving_size, serving_qty=m.serving_qty,
                serving_weight_g=m.serving_weight_g, calories=m.calories,
                protein=m.protein, carbs=m.carbs, fat=m.fat, is_fasted=m.is_fasted
            ) for m in logged_objs
        ]
    )

@router.post("/meals", response_model=MealResponse, status_code=status.HTTP_201_CREATED)
def create_meal(
    req: MealCreateRequest,
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if req.client_event_id:
        existing = db.query(ProcessedEvent).filter(ProcessedEvent.client_event_id == req.client_event_id).first()
        if existing:
            m = db.query(MealLog).filter(MealLog.username == user.username, MealLog.client_event_id == req.client_event_id).first()
            if m:
                return MealResponse(
                    id=m.id, date=m.date, time=m.time, food_name=m.food_name,
                    serving_size=m.serving_size, serving_qty=m.serving_qty,
                    serving_weight_g=m.serving_weight_g, calories=m.calories,
                    protein=m.protein, carbs=m.carbs, fat=m.fat, is_fasted=m.is_fasted
                )

    meal = MealLog(
        username=user.username,
        date=req.date,
        time=req.time or datetime.utcnow().strftime("%I:%M %p"),
        food_name=req.food_name,
        serving_size=req.serving_size,
        serving_qty=req.serving_qty,
        serving_weight_g=req.serving_weight_g,
        calories=req.calories,
        protein=req.protein,
        carbs=req.carbs,
        fat=req.fat,
        is_fasted=req.is_fasted,
        client_event_id=req.client_event_id
    )
    db.add(meal)

    if req.client_event_id:
        db.add(ProcessedEvent(client_event_id=req.client_event_id, endpoint="/v1/food/meals"))

    db.commit()
    db.refresh(meal)

    recalculate_user_tdee(db, user.username)

    return MealResponse(
        id=meal.id, date=meal.date, time=meal.time, food_name=meal.food_name,
        serving_size=meal.serving_size, serving_qty=meal.serving_qty,
        serving_weight_g=meal.serving_weight_g, calories=meal.calories,
        protein=meal.protein, carbs=meal.carbs, fat=meal.fat, is_fasted=meal.is_fasted
    )

@router.get("/meals", response_model=List[MealResponse])
def get_meals(
    date: str,
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    meals = db.query(MealLog).filter(MealLog.username == user.username, MealLog.date == date).all()
    return [
        MealResponse(
            id=m.id, date=m.date, time=m.time, food_name=m.food_name,
            serving_size=m.serving_size, serving_qty=m.serving_qty,
            serving_weight_g=m.serving_weight_g, calories=m.calories,
            protein=m.protein, carbs=m.carbs, fat=m.fat, is_fasted=m.is_fasted
        ) for m in meals
    ]

@router.delete("/meals/{meal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meal(
    meal_id: str,
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    meal = db.query(MealLog).filter(MealLog.username == user.username, MealLog.id == meal_id).first()
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")

    db.delete(meal)
    db.commit()

    recalculate_user_tdee(db, user.username)

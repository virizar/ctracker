import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from typing import List, Optional, Union
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.db.models import UserProfile, MealLog, FoodCatalog, ProcessedEvent
from app.services.auth import get_current_user
from app.services.tdee import recalculate_user_tdee

router = APIRouter(prefix="/v1/food", tags=["Food & Meals"])

class MealCreateRequest(BaseModel):
    date: str = Field(description="Date in YYYY-MM-DD format")
    time: Optional[str] = Field(default=None, description="Time e.g. 12:30 PM")
    food_name: str = Field(description="Display / Original description e.g. 5 4-inch pancakes")
    canonical_name: Optional[str] = Field(default=None, description="Standardized category e.g. Pancake, homemade")
    serving_size: Optional[str] = "1 serving"
    serving_qty: float = 1.0
    serving_weight_g: Optional[float] = None
    calories: float
    protein: float = 0.0
    carbs: float = 0.0
    fat: float = 0.0
    is_fasted: bool = False
    client_event_id: Optional[str] = None

class BatchMealCreateRequest(BaseModel):
    meals: List[MealCreateRequest]
    client_event_id: Optional[str] = None

class MealResponse(BaseModel):
    id: str
    date: str
    time: Optional[str]
    food_name: str
    canonical_name: Optional[str]
    food_catalog_id: Optional[str]
    serving_size: Optional[str]
    serving_qty: float
    serving_weight_g: Optional[float]
    calories: float
    protein: float
    carbs: float
    fat: float
    is_fasted: bool

class CatalogItemResponse(BaseModel):
    id: str
    canonical_name: str
    default_unit: Optional[str]
    calories_per_100g: Optional[float]
    protein_per_100g: Optional[float]
    carbs_per_100g: Optional[float]
    fat_per_100g: Optional[float]
    usage_count: int

def get_or_create_food_catalog(
    db: Session,
    username: str,
    canonical_name: str,
    serving_size: Optional[str],
    serving_weight_g: Optional[float],
    calories: float,
    protein: float,
    carbs: float,
    fat: float
) -> FoodCatalog:
    clean_name = canonical_name.strip()
    catalog = db.query(FoodCatalog).filter(
        FoodCatalog.username == username,
        FoodCatalog.canonical_name.ilike(clean_name)
    ).first()

    if catalog:
        catalog.usage_count += 1
        return catalog

    c_100 = (calories / serving_weight_g * 100.0) if serving_weight_g and serving_weight_g > 0 else None
    p_100 = (protein / serving_weight_g * 100.0) if serving_weight_g and serving_weight_g > 0 else None
    cb_100 = (carbs / serving_weight_g * 100.0) if serving_weight_g and serving_weight_g > 0 else None
    f_100 = (fat / serving_weight_g * 100.0) if serving_weight_g and serving_weight_g > 0 else None

    catalog = FoodCatalog(
        username=username,
        canonical_name=clean_name,
        default_unit=serving_size or "serving",
        calories_per_100g=round(c_100, 1) if c_100 else None,
        protein_per_100g=round(p_100, 1) if p_100 else None,
        carbs_per_100g=round(cb_100, 1) if cb_100 else None,
        fat_per_100g=round(f_100, 1) if f_100 else None,
        usage_count=1
    )
    db.add(catalog)
    db.commit()
    db.refresh(catalog)
    return catalog


@router.post("/meals", response_model=List[MealResponse], status_code=status.HTTP_201_CREATED)
def create_meals_batch(
    payload: Union[MealCreateRequest, List[MealCreateRequest], BatchMealCreateRequest],
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    items_to_create: List[MealCreateRequest] = []
    global_event_id: Optional[str] = None

    if isinstance(payload, BatchMealCreateRequest):
        items_to_create = payload.meals
        global_event_id = payload.client_event_id
    elif isinstance(payload, list):
        items_to_create = payload
        global_event_id = items_to_create[0].client_event_id if items_to_create else None
    else:
        items_to_create = [payload]
        global_event_id = payload.client_event_id

    if global_event_id:
        existing = db.query(ProcessedEvent).filter(ProcessedEvent.client_event_id == global_event_id).first()
        if existing:
            meals = db.query(MealLog).filter(MealLog.username == user.username, MealLog.client_event_id == global_event_id).all()
            return [
                MealResponse(
                    id=m.id, date=m.date, time=m.time, food_name=m.food_name,
                    canonical_name=m.canonical_name, food_catalog_id=m.food_catalog_id,
                    serving_size=m.serving_size, serving_qty=m.serving_qty,
                    serving_weight_g=m.serving_weight_g, calories=m.calories,
                    protein=m.protein, carbs=m.carbs, fat=m.fat, is_fasted=m.is_fasted
                ) for m in meals
            ]

    created_meals = []
    for req in items_to_create:
        event_id = req.client_event_id or global_event_id
        c_name = req.canonical_name or req.food_name
        catalog_obj = get_or_create_food_catalog(
            db, user.username, c_name, req.serving_size, req.serving_weight_g,
            req.calories, req.protein, req.carbs, req.fat
        )

        meal = MealLog(
            username=user.username,
            date=req.date,
            time=req.time or datetime.now(timezone.utc).strftime("%I:%M %p"),
            food_name=req.food_name,
            canonical_name=c_name,
            food_catalog_id=catalog_obj.id,
            serving_size=req.serving_size,
            serving_qty=req.serving_qty,
            serving_weight_g=req.serving_weight_g,
            calories=req.calories,
            protein=req.protein,
            carbs=req.carbs,
            fat=req.fat,
            is_fasted=req.is_fasted,
            client_event_id=event_id
        )
        db.add(meal)
        created_meals.append(meal)

    if global_event_id:
        db.add(ProcessedEvent(client_event_id=global_event_id, endpoint="/v1/food/meals"))

    db.commit()
    for m in created_meals:
        db.refresh(m)

    recalculate_user_tdee(db, user.username)

    return [
        MealResponse(
            id=m.id, date=m.date, time=m.time, food_name=m.food_name,
            canonical_name=m.canonical_name, food_catalog_id=m.food_catalog_id,
            serving_size=m.serving_size, serving_qty=m.serving_qty,
            serving_weight_g=m.serving_weight_g, calories=m.calories,
            protein=m.protein, carbs=m.carbs, fat=m.fat, is_fasted=m.is_fasted
        ) for m in created_meals
    ]


@router.get("/search", response_model=List[CatalogItemResponse])
def search_food_catalog(
    q: str = Query(description="Search term e.g. pancake"),
    user: UserProfile = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    clean_q = q.strip()
    if not clean_q:
        return []

    from sqlalchemy import text
    from app.config import settings

    if "sqlite" in settings.DATABASE_URL:
        # Build token prefix search e.g. "pancake*"
        terms = [t.replace('"', '') for t in clean_q.split() if t]
        fts_query = " ".join([f"{t}*" for t in terms])
        try:
            raw_sql = text("""
                SELECT c.id, c.canonical_name, c.default_unit, c.calories_per_100g, 
                       c.protein_per_100g, c.carbs_per_100g, c.fat_per_100g, c.usage_count
                FROM food_catalog c
                JOIN food_catalog_fts fts ON c.rowid = fts.rowid
                WHERE fts.username = :u AND food_catalog_fts MATCH :term
                ORDER BY bm25(food_catalog_fts) ASC, c.usage_count DESC
                LIMIT 20
            """)
            rows = db.execute(raw_sql, {"u": user.username, "term": fts_query}).fetchall()
            if rows:
                return [
                    CatalogItemResponse(
                        id=r[0],
                        canonical_name=r[1],
                        default_unit=r[2],
                        calories_per_100g=r[3],
                        protein_per_100g=r[4],
                        carbs_per_100g=r[5],
                        fat_per_100g=r[6],
                        usage_count=r[7]
                    ) for r in rows
                ]
        except Exception:
            pass

    # Fallback to ilike pattern match
    results = db.query(FoodCatalog).filter(
        FoodCatalog.username == user.username,
        FoodCatalog.canonical_name.ilike(f"%{clean_q}%")
    ).order_by(FoodCatalog.usage_count.desc()).limit(20).all()

    return [
        CatalogItemResponse(
            id=c.id,
            canonical_name=c.canonical_name,
            default_unit=c.default_unit,
            calories_per_100g=c.calories_per_100g,
            protein_per_100g=c.protein_per_100g,
            carbs_per_100g=c.carbs_per_100g,
            fat_per_100g=c.fat_per_100g,
            usage_count=c.usage_count
        ) for c in results
    ]


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
            canonical_name=m.canonical_name, food_catalog_id=m.food_catalog_id,
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

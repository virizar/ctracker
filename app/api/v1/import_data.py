import gzip
import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.v1.food import get_or_create_food_catalog
from app.db.models import MealLog, ScaleWeight, UserProfile
from app.db.session import get_db
from app.services.auth import get_current_user
from app.services.tdee import recalculate_user_tdee

router = APIRouter(prefix="/v1/import", tags=["Data Migration"])


class WeightImportItem(BaseModel):
    date: str = Field(description="Date in YYYY-MM-DD format")
    raw_weight: float = Field(description="Scale weight value in kg")


class MealImportItem(BaseModel):
    date: str = Field(description="Date in YYYY-MM-DD format")
    time: str | None = Field(default=None, description="Time e.g. 12:30 PM")
    food_name: str = Field(description="Display / Original description")
    canonical_name: str | None = Field(default=None, description="Standardized category e.g. Pancake, homemade")
    serving_size: str | None = "1 serving"
    serving_qty: float = 1.0
    serving_weight_g: float | None = None
    calories: float
    protein: float = 0.0
    carbs: float = 0.0
    fat: float = 0.0
    is_fasted: bool = False


class ImportPayload(BaseModel):
    weights: list[WeightImportItem] = []
    meals: list[MealImportItem] = []


class ImportResponse(BaseModel):
    status: str
    weights_imported: int
    meals_imported: int
    message: str


@router.post("/file", response_model=ImportResponse, status_code=status.HTTP_200_OK)
async def import_file(
    file: UploadFile = File(...), user: UserProfile = Depends(get_current_user), db: Session = Depends(get_db)
):
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        if (file.filename and file.filename.endswith(".gz")) or content.startswith(b"\x1f\x8b"):
            try:
                content = gzip.decompress(content)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to decompress gzip file: {str(e)}") from e

        try:
            raw_json = json.loads(content.decode("utf-8"))
            payload = ImportPayload(**raw_json)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid JSON payload: {str(e)}") from e

        # Bulk upsert scale weights
        weights_imported = 0
        for w_item in payload.weights:
            existing_w = (
                db.query(ScaleWeight)
                .filter(ScaleWeight.username == user.username, ScaleWeight.date == w_item.date)
                .first()
            )
            if existing_w:
                existing_w.raw_weight = w_item.raw_weight
            else:
                db.add(ScaleWeight(username=user.username, date=w_item.date, raw_weight=w_item.raw_weight))
            weights_imported += 1

        # Bulk insert meal logs & catalog entries
        meals_imported = 0
        for m_item in payload.meals:
            c_name = m_item.canonical_name or m_item.food_name
            catalog_obj = get_or_create_food_catalog(
                db,
                user.username,
                c_name,
                m_item.serving_size,
                m_item.serving_weight_g,
                m_item.calories,
                m_item.protein,
                m_item.carbs,
                m_item.fat,
            )
            meal = MealLog(
                username=user.username,
                date=m_item.date,
                time=m_item.time,
                food_name=m_item.food_name,
                canonical_name=c_name,
                food_catalog_id=catalog_obj.id if catalog_obj else None,
                serving_size=m_item.serving_size,
                serving_qty=m_item.serving_qty,
                serving_weight_g=m_item.serving_weight_g,
                calories=m_item.calories,
                protein=m_item.protein,
                carbs=m_item.carbs,
                fat=m_item.fat,
                is_fasted=m_item.is_fasted,
            )
            db.add(meal)
            meals_imported += 1

        db.commit()

        # Recalculate TDEE once for the user after all historical entries are inserted
        recalculate_user_tdee(db, user.username)

        return ImportResponse(
            status="success",
            weights_imported=weights_imported,
            meals_imported=meals_imported,
            message="Successfully imported bulk data and updated TDEE trends.",
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}") from e

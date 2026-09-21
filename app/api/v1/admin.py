import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.db.models import APIKey, UserProfile
from app.db.session import get_db
from app.services.auth import verify_master_key

router = APIRouter(prefix="/v1/admin", tags=["Admin"], dependencies=[Depends(verify_master_key)])


class CreateKeyRequest(BaseModel):
    username: str
    key_name: str | None = "Default Key"


class APIKeyResponse(BaseModel):
    id: str
    key: str
    username: str
    name: str
    is_active: bool


@router.post("/keys", response_model=APIKeyResponse, status_code=status.HTTP_201_CREATED)
def create_api_key(req: CreateKeyRequest, db: Session = Depends(get_db)):
    # Ensure user profile exists or create default
    user = db.query(UserProfile).filter(UserProfile.username == req.username).first()
    if not user:
        user = UserProfile(
            username=req.username,
            dob=settings.DEFAULT_USER_DOB,
            height_cm=settings.DEFAULT_USER_HEIGHT_CM,
            sex=settings.DEFAULT_USER_SEX,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    generated_key = f"ctk_live_{uuid.uuid4().hex}"
    key_obj = APIKey(key=generated_key, username=req.username, name=req.key_name, is_active=True)
    db.add(key_obj)
    db.commit()
    db.refresh(key_obj)

    return APIKeyResponse(
        id=key_obj.id, key=key_obj.key, username=key_obj.username, name=key_obj.name, is_active=key_obj.is_active
    )


@router.get("/keys", response_model=list[APIKeyResponse])
def list_api_keys(db: Session = Depends(get_db)):
    keys = db.query(APIKey).all()
    return [APIKeyResponse(id=k.id, key=k.key, username=k.username, name=k.name, is_active=k.is_active) for k in keys]


@router.delete("/keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_api_key(key_id: str, db: Session = Depends(get_db)):
    key_obj = db.query(APIKey).filter(APIKey.id == key_id).first()
    if not key_obj:
        raise HTTPException(status_code=404, detail="Key not found")
    key_obj.is_active = False
    db.commit()

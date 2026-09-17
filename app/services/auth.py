from fastapi import Security, HTTPException, status, Depends
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.config import settings
from app.db.session import get_db
from app.db.models import APIKey, UserProfile

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_scheme = HTTPBearer(auto_error=False)
master_key_header = APIKeyHeader(name="X-Master-Key", auto_error=False)

def get_current_user(
    x_api_key: str = Security(api_key_header),
    bearer: HTTPAuthorizationCredentials = Security(bearer_scheme),
    db: Session = Depends(get_db)
) -> UserProfile:
    token = None
    if x_api_key:
        token = x_api_key
    elif bearer and bearer.credentials:
        token = bearer.credentials

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API Key. Provide via 'X-API-Key' header or 'Authorization: Bearer <key>'"
        )

    api_key_obj = db.query(APIKey).filter(APIKey.key == token, APIKey.is_active == True).first()
    if not api_key_obj:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked API Key"
        )

    user = db.query(UserProfile).filter(UserProfile.username == api_key_obj.username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Associated user profile not found"
        )

    return user

def verify_master_key(x_master_key: str = Security(master_key_header)):
    if not x_master_key or x_master_key != settings.MASTER_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing X-Master-Key header for admin actions"
        )
    return True

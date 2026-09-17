from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.session import engine, Base, SessionLocal
from app.db.models import UserProfile, APIKey
from app.config import settings
from app.api.v1 import admin, auth, weight, food, dashboard

# Create database tables
Base.metadata.create_all(bind=engine)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure default user & initial API key exist on startup
    db = SessionLocal()
    try:
        user = db.query(UserProfile).filter(UserProfile.username == "default_user").first()
        if not user:
            user = UserProfile(
                username="default_user",
                dob=settings.DEFAULT_USER_DOB,
                height_cm=settings.DEFAULT_USER_HEIGHT_CM,
                sex=settings.DEFAULT_USER_SEX
            )
            db.add(user)
            db.commit()

        key_obj = db.query(APIKey).filter(APIKey.username == "default_user").first()
        if not key_obj:
            key_obj = APIKey(
                key="ctk_live_default_dev_key",
                username="default_user",
                name="Default Development Key"
            )
            db.add(key_obj)
            db.commit()
    finally:
        db.close()
    yield

app = FastAPI(
    title="Calorie & TDEE Tracker API",
    version="1.0.0",
    description="Self-hosted calorie tracking API with dynamic TDEE estimation and Gemini AI meal parsing.",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(weight.router)
app.include_router(food.router)
app.include_router(dashboard.router)

@app.get("/")
def health_check():
    return {
        "status": "healthy",
        "service": "ctracker_api",
        "version": "1.0.0",
        "docs": "/docs"
    }

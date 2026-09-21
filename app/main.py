from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi

from app.api.v1 import admin, agent, auth, dashboard, food, import_data, weight
from app.config import settings
from app.db.models import APIKey, UserProfile
from app.db.session import SessionLocal, init_fts5_and_db
from app.services.auth import get_current_user

# Initialize tables, FTS5 virtual table, and triggers
init_fts5_and_db()


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
                sex=settings.DEFAULT_USER_SEX,
            )
            db.add(user)
            db.commit()

        key_obj = db.query(APIKey).filter(APIKey.username == "default_user").first()
        if not key_obj:
            key_obj = APIKey(key="ctk_live_default_dev_key", username="default_user", name="Default Development Key")
            db.add(key_obj)
            db.commit()
    finally:
        db.close()
    yield


app = FastAPI(
    title="Calorie & TDEE Tracker API",
    version="1.0.0",
    description="Self-hosted calorie tracking API with dynamic TDEE estimation.",
    lifespan=lifespan,
    openapi_url=None,
    docs_url=None,
    redoc_url=None,
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
app.include_router(import_data.router)
app.include_router(agent.router)


@app.get("/openapi.json", include_in_schema=False)
def get_protected_openapi(user: UserProfile = Depends(get_current_user)):
    return get_openapi(title=app.title, version=app.version, routes=app.routes)


@app.get("/docs", include_in_schema=False)
def get_protected_docs(user: UserProfile = Depends(get_current_user)):
    return get_swagger_ui_html(openapi_url="/openapi.json", title=app.title)


@app.get("/")
def health_check():
    return {"status": "healthy", "service": "ctracker_api", "version": "1.0.0", "docs": "/docs"}

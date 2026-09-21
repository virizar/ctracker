from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from app.db.models import UserProfile
from app.services.auth import get_current_user

router = APIRouter(prefix="/v1/agent", tags=["Agent Integration"])


class AgentConfigResponse(BaseModel):
    version: str
    service: str
    system_instructions: str
    protocols: dict[str, Any]


PROMPT_FILE_PATH = Path(__file__).resolve().parent.parent.parent.parent / "agent" / "SYSTEM_PROMPT.md"


@router.get("/config", response_model=AgentConfigResponse, status_code=status.HTTP_200_OK)
def get_agent_config(user: UserProfile = Depends(get_current_user)):
    instructions = ""
    if PROMPT_FILE_PATH.exists():
        instructions = PROMPT_FILE_PATH.read_text(encoding="utf-8")

    return AgentConfigResponse(
        version="1.0.0",
        service="ctracker_api",
        system_instructions=instructions,
        protocols={
            "search_first": True,
            "human_confirmation_required": True,
            "safety_floor_kcal": user.min_daily_calories,
            "target_monthly_rate_kg": user.target_monthly_rate_kg,
        },
    )

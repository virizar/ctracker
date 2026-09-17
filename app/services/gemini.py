import json
import httpx
from pydantic import BaseModel, Field
from typing import List, Optional
from app.config import settings

class ParsedFoodItem(BaseModel):
    food_name: str
    serving_size: Optional[str] = "portion"
    serving_qty: float = 1.0
    serving_weight_g: Optional[float] = 100.0
    calories: float = Field(description="Estimated total calories in kcal")
    protein: float = Field(description="Protein in grams")
    carbs: float = Field(description="Carbohydrates in grams")
    fat: float = Field(description="Fat in grams")

class InterpretationResult(BaseModel):
    summary: str
    foods: List[ParsedFoodItem]

async def parse_meal_text_with_gemini(text: str) -> InterpretationResult:
    if not settings.GEMINI_API_KEY:
        # Fallback mock for testing without API key
        return InterpretationResult(
            summary=f"Parsed (Mock Mode): '{text}'",
            foods=[
                ParsedFoodItem(
                    food_name=text.capitalize(),
                    serving_size="1 serving",
                    serving_qty=1.0,
                    serving_weight_g=150.0,
                    calories=350.0,
                    protein=25.0,
                    carbs=30.0,
                    fat=12.0
                )
            ]
        )

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={settings.GEMINI_API_KEY}"
    
    prompt = f"""
    You are an expert nutritional AI. Interpret the following text description of a meal/food intake and extract structured calorie and macronutrient data for each item.
    
    User Text Input: "{text}"
    
    Respond STRICTLY with valid JSON matching this schema:
    {{
      "summary": "Brief summary of identified items",
      "foods": [
        {{
          "food_name": "Name of food item",
          "serving_size": "Unit/Serving description",
          "serving_qty": 1.0,
          "serving_weight_g": 100.0,
          "calories": 140.0,
          "protein": 12.0,
          "carbs": 0.5,
          "fat": 10.0
        }}
      ]
    }}
    """

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"response_mime_type": "application/json"}
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(url, json=payload)
        if res.status_code != 200:
            raise RuntimeError(f"Gemini API returned status {res.status_code}: {res.text}")
        
        data = res.json()
        raw_json_str = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(raw_json_str)
        return InterpretationResult(**parsed)

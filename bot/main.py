import logging
import os
import sys
import uuid

import httpx
from google import genai
from google.genai import types
from telegram import Update
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

# Configure Logging
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("ctracker_bot")

# Configuration from Environment
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
CTRACKER_API_URL = os.getenv("CTRACKER_API_URL", "http://localhost:8000").rstrip("/")
CTRACKER_API_KEY = os.getenv("CTRACKER_API_KEY", "")
ALLOWED_USER_IDS = [
    int(uid.strip()) for uid in os.getenv("ALLOWED_TELEGRAM_USER_IDS", "").split(",") if uid.strip().isdigit()
]

# HTTP Client for ctracker_api
http_client = httpx.Client(
    base_url=CTRACKER_API_URL,
    headers={"X-API-Key": CTRACKER_API_KEY} if CTRACKER_API_KEY else {},
    timeout=15.0,
)

# System Instructions for Gemini
SYSTEM_INSTRUCTION = """
You are Calorie & Nutrition Assistant for ctracker_api.
Your job is to help the user track calories, scale weight, and view progress using their self-hosted ctracker_api backend tools.

Tool Rules:
1. When the user mentions food intake (text or image), interpret food items, search personal database first via `search_food`, and calculate macros.
2. Render a clean Markdown summary table with Food Item, Serving, Calories, Protein, Carbs, Fat.
3. Call `log_meals` to save confirmed meals.
4. When user mentions weight (e.g. "weighed 84.2 kg"), call `log_weight`.
5. When user asks for status/progress, call `get_dashboard`.
6. Always remain encouraging, precise, and adherence-neutral.
"""


# Tool Functions for Gemini Function Calling
def search_food(query: str) -> dict:
    """Search personal food catalog for saved items and macro densities."""
    try:
        res = http_client.get("/v1/food/search", params={"q": query})
        res.raise_for_status()
        return res.json()
    except Exception as e:
        logger.error(f"Error in search_food: {e}")
        return {"items": [], "error": str(e)}


def log_meals(meals: list[dict], client_event_id: str | None = None) -> dict:
    """Log a batch of meal items to ctracker_api."""
    if not client_event_id:
        client_event_id = f"evt_meal_{uuid.uuid4().hex[:10]}"
    try:
        payload = {"client_event_id": client_event_id, "meals": meals}
        res = http_client.post("/v1/food/meals", json=payload)
        res.raise_for_status()
        return res.json()
    except Exception as e:
        logger.error(f"Error in log_meals: {e}")
        return {"error": str(e)}


def log_weight(raw_weight: float, date: str | None = None, client_event_id: str | None = None) -> dict:
    """Log daily scale weight in kg."""
    if not client_event_id:
        client_event_id = f"evt_weight_{uuid.uuid4().hex[:10]}"
    payload = {"raw_weight": raw_weight, "client_event_id": client_event_id}
    if date:
        payload["date"] = date
    try:
        res = http_client.post("/v1/weight", json=payload)
        res.raise_for_status()
        return res.json()
    except Exception as e:
        logger.error(f"Error in log_weight: {e}")
        return {"error": str(e)}


def get_dashboard(date: str | None = None) -> dict:
    """Retrieve daily summary dashboard including TDEE, trend weight, and calorie budget."""
    params = {}
    if date:
        params["date"] = date
    try:
        res = http_client.get("/v1/dashboard/summary", params=params)
        res.raise_for_status()
        return res.json()
    except Exception as e:
        logger.error(f"Error in get_dashboard: {e}")
        return {"error": str(e)}


TOOL_MAPPING = {
    "search_food": search_food,
    "log_meals": log_meals,
    "log_weight": log_weight,
    "get_dashboard": get_dashboard,
}


def is_user_allowed(user_id: int) -> bool:
    if not ALLOWED_USER_IDS:
        return True
    return user_id in ALLOWED_USER_IDS


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or not is_user_allowed(update.effective_user.id):
        return

    welcome_text = (
        "👋 *Welcome to Calorie & Nutrition Assistant!*\n\n"
        "I am connected to your self-hosted `ctracker_api` backend.\n\n"
        "You can:\n"
        "• 🍎 *Describe food*: Send text or food photos (e.g., *'Ate 3 pancakes with butter'*)\n"
        "• ⚖️ *Log weight*: Tell me your weight (e.g., *'Weighed 84.2 kg today'*)\n"
        "• 📊 *Check progress*: Send `/status` or ask *'How am I doing today?'*"
    )
    await update.message.reply_text(welcome_text, parse_mode="Markdown")


async def status_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or not is_user_allowed(update.effective_user.id):
        return

    data = get_dashboard()
    if "error" in data:
        await update.message.reply_text(f"❌ Failed to fetch dashboard: {data['error']}")
        return

    msg = (
        f"📊 *Daily Summary ({data.get('date', 'Today')})*\n\n"
        f"🔥 *Calories Consumed*: {data.get('calories_consumed', 0)} / {data.get('target_calories', 0)} kcal\n"
        f"💡 *Remaining Budget*: {data.get('remaining_calories', 0)} kcal\n"
        f"🥩 *Protein Target*: {data.get('protein_consumed_g', 0)}g / {data.get('target_protein_g', 0)}g\n"
        f"⚖️ *Trend Weight*: {data.get('trend_weight_kg', 'N/A')} kg\n"
        f"🔥 *Estimated TDEE*: {data.get('tdee_estimate', 'N/A')} kcal/day"
    )
    await update.message.reply_text(msg, parse_mode="Markdown")


async def message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or not is_user_allowed(update.effective_user.id):
        return

    if not update.message:
        return

    user_text = update.message.text or update.message.caption or ""
    image_bytes = None

    # Handle Photo Input
    if update.message.photo:
        photo_file = await update.message.photo[-1].get_file()
        image_bytes = await photo_file.download_as_bytearray()
        if not user_text:
            user_text = "Identify the food items in this image, calculate calories & macros, and summarize them."

    if not user_text and not image_bytes:
        return

    await update.message.chat.send_action(action="typing")

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        tools = [search_food, log_meals, log_weight, get_dashboard]

        contents = []
        if image_bytes:
            contents.append(
                types.Part.from_bytes(
                    data=bytes(image_bytes),
                    mime_type="image/jpeg",
                )
            )
        contents.append(user_text)

        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            tools=tools,
            temperature=0.2,
        )

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=contents,
            config=config,
        )

        # Handle tool calls if returned by Gemini
        if response.function_calls:
            for call in response.function_calls:
                fn_name = call.name
                fn_args = dict(call.args)
                if fn_name in TOOL_MAPPING:
                    logger.info(f"Executing tool call {fn_name} with args {fn_args}")
                    tool_res = TOOL_MAPPING[fn_name](**fn_args)
                    # Send follow-up prompt with tool response
                    follow_up = client.models.generate_content(
                        model="gemini-2.5-flash",
                        contents=f"Tool {fn_name} returned: {tool_res}. Present final response to user.",
                        config=types.GenerateContentConfig(system_instruction=SYSTEM_INSTRUCTION),
                    )
                    if follow_up.text:
                        await update.message.reply_text(follow_up.text, parse_mode="Markdown")
                        return

        if response.text:
            await update.message.reply_text(response.text, parse_mode="Markdown")
        else:
            await update.message.reply_text("✅ Operation processed successfully.")

    except Exception as e:
        logger.error(f"Error handling message with Gemini: {e}")
        await update.message.reply_text(f"❌ Error processing request: {e}")


def main() -> None:
    if not TELEGRAM_BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN environment variable is missing. Bot exiting.")
        sys.exit(1)

    if not GEMINI_API_KEY:
        logger.error("GEMINI_API_KEY environment variable is missing. Bot exiting.")
        sys.exit(1)

    logger.info("Starting Calorie & Nutrition Assistant Telegram Bot...")
    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start_handler))
    app.add_handler(CommandHandler("status", status_handler))
    app.add_handler(MessageHandler(filters.TEXT | filters.PHOTO, message_handler))

    app.run_polling()


if __name__ == "__main__":
    main()

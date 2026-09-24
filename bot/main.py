import io
import logging
import os
import re
import sys
import uuid

import httpx
import openpyxl
from google import genai
from google.genai import types
from telegram import Update
from telegram.error import BadRequest
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
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
CTRACKER_API_URL = os.getenv("CTRACKER_API_URL", "http://localhost:8000").rstrip("/")
CTRACKER_API_KEY = os.getenv("CTRACKER_API_KEY", "")
ALLOWED_USER_IDS = [
    int(uid.strip()) for uid in os.getenv("ALLOWED_TELEGRAM_USER_IDS", "").split(",") if uid.strip().isdigit()
]

# HTTP Client for ctracker
http_client = httpx.Client(
    base_url=CTRACKER_API_URL,
    headers={"X-API-Key": CTRACKER_API_KEY} if CTRACKER_API_KEY else {},
    timeout=30.0,
)

# System Instructions for Gemini
SYSTEM_INSTRUCTION = """
You are Calorie & Nutrition Assistant for ctracker.
Your job is to help the user track calories, scale weight, import historical data dumps, and view progress using their self-hosted ctracker backend tools.

Tool Rules:
1. When the user mentions food intake (text or image), interpret food items, search personal database first via `search_food`, and calculate macros.
2. Render a clean Markdown summary table with Food Item, Serving, Calories, Protein, Carbs, Fat.
3. Call `log_meals` to save confirmed meals.
4. When user mentions weight (e.g. "weighed 84.2 kg"), call `log_weight`.
5. When user asks for status/progress, call `get_dashboard`.
6. When user uploads a data dump file (CSV, JSON, TXT) from third-party apps (MyFitnessPal, LoseIt, Apple Health, etc.):
   - Analyze column headers, data formats, dates, and units.
   - If data format is ambiguous or missing units (e.g. lbs vs kg, date format), ask the user for clarification before logging.
   - Once clear, transform and batch log using `log_meals` and `log_weight` or `import_data_file`.
7. Always remain encouraging, precise, and adherence-neutral.
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
    """Log a batch of meal items to ctracker."""
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


def cure_telegram_markdown(text: str) -> str:
    """Cure and sanitize Markdown text for Telegram V1 parser.

    1. Replaces line-starting bullet points ('* item' or '- item') with unicode '• item'.
    2. Escapes underscores inside identifiers (e.g. client_event_id -> client\_event\_id).
    3. Balances odd counts of unclosed formatting delimiters (*, `, _).
    """
    if not text:
        return text

    # Step 1: Replace line-starting bullet points with unicode bullets
    cured = re.sub(r"(?m)^[ \t]*[*\-][ \t]+", "• ", text)

    # Step 2: Escape standalone underscores inside words (e.g. client_event_id -> client\_event\_id)
    cured = re.sub(r"(?<=\w)_(?=\w)", r"\_", cured)

    # Step 3: Balance unclosed inline code backticks if odd count
    if cured.count("`") % 2 != 0:
        cured += "`"

    # Step 4: Balance unclosed bold asterisks if odd count
    if cured.count("*") % 2 != 0:
        cured += "*"

    return cured


async def send_safe_reply(update: Update, text: str) -> None:
    """Send reply to Telegram attempting cured Markdown first, falling back to raw text if Telegram rejects it."""
    if not update.message or not text:
        return

    cured_text = cure_telegram_markdown(text)
    try:
        await update.message.reply_text(cured_text, parse_mode="Markdown")
    except BadRequest as e:
        logger.warning(f"Telegram Markdown parse error ('{e}'). Falling back to raw text reply.")
        await update.message.reply_text(text)


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or not is_user_allowed(update.effective_user.id):
        return

    welcome_text = (
        "👋 *Welcome to Calorie & Nutrition Assistant!*\n\n"
        "I am connected to your self-hosted `ctracker` backend.\n\n"
        "You can:\n"
        "• 🍎 *Describe food*: Send text or food photos (e.g., *'Ate 3 pancakes with butter'*)\n"
        "• ⚖️ *Log weight*: Tell me your weight (e.g., *'Weighed 84.2 kg today'*)\n"
        "• 📁 *Import data*: Send a `.json`, `.json.gz`, `.xlsx`, or CSV export file from another app\n"
        "• 📊 *Check progress*: Send `/status` or ask *'How am I doing today?'*"
    )
    await send_safe_reply(update, welcome_text)


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
    await send_safe_reply(update, msg)


def parse_excel_to_text(file_bytes: bytes) -> str:
    """Parse Excel (.xlsx, .xlsm) workbook bytes into clean tabular text for Gemini LLM analysis."""
    try:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        out_lines = []
        for sheet_name in wb.sheetnames:
            sheet = wb[sheet_name]
            out_lines.append(f"--- Sheet: {sheet_name} ---")
            for row in sheet.iter_rows(values_only=True):
                if any(cell is not None for cell in row):
                    row_str = ", ".join(str(cell) if cell is not None else "" for cell in row)
                    out_lines.append(row_str)
        return "\n".join(out_lines)
    except Exception as e:
        logger.error(f"Error parsing Excel file: {e}")
        return f"[Error parsing Excel file: {e}]"


async def document_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or not is_user_allowed(update.effective_user.id):
        return

    if not update.message or not update.message.document:
        return

    doc = update.message.document
    filename = doc.file_name or "uploaded_file.txt"
    await update.message.chat.send_action(action="typing")

    try:
        doc_file = await doc.get_file()
        file_bytes = bytes(await doc_file.download_as_bytearray())

        # Path A: Official ctracker json / json.gz bulk import endpoint
        if filename.endswith(".json") or filename.endswith(".json.gz"):
            mime = "application/gzip" if filename.endswith(".gz") else "application/json"
            res = http_client.post(
                "/v1/import/file",
                files={"file": (filename, file_bytes, mime)},
            )
            if res.status_code == 200:
                resp_json = res.json()
                msg = (
                    f"✅ *Bulk Import Successful!*\n\n"
                    f"• 🏋️ Scale Weight Entries: *{resp_json.get('weights_imported', 0)}*\n"
                    f"• 🍎 Meal Log Entries: *{resp_json.get('meals_imported', 0)}*"
                )
                await send_safe_reply(update, msg)
                return

        # Path B: AI Multimodal / Raw Text Analysis for 3rd Party Dumps (CSV, Excel, JSON, TXT)
        text_content = ""
        filename_lower = filename.lower()
        if filename_lower.endswith((".xlsx", ".xls", ".xlsm")):
            text_content = parse_excel_to_text(file_bytes)
        else:
            try:
                text_content = file_bytes.decode("utf-8", errors="ignore")
            except Exception:
                text_content = "[Binary file data attached]"

        # Send raw dump content to Gemini to parse, ask questions if needed, or invoke logging tools
        prompt = (
            f"The user uploaded a data dump file named '{filename}'.\n"
            f"File content snippet:\n```\n{text_content[:30000]}\n```\n\n"
            f"Analyze this file. Identify dates, meal items, calories, macros, and scale weight entries.\n"
            f"If the data structure or units (e.g. lbs vs kg) are ambiguous, ask the user for clarification.\n"
            f"If clear, call `log_weight` and `log_meals` to import the records into ctracker."
        )

        client = genai.Client(api_key=GEMINI_API_KEY)
        tools = [search_food, log_meals, log_weight, get_dashboard]

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                tools=tools,
                temperature=0.2,
            ),
        )

        if response.function_calls:
            for call in response.function_calls:
                fn_name = call.name
                fn_args = dict(call.args)
                if fn_name in TOOL_MAPPING:
                    logger.info(f"Executing tool call {fn_name} for document import")
                    tool_res = TOOL_MAPPING[fn_name](**fn_args)
                    follow_up = client.models.generate_content(
                        model=GEMINI_MODEL,
                        contents=f"Tool {fn_name} returned: {tool_res}. Present final import summary to user.",
                        config=types.GenerateContentConfig(system_instruction=SYSTEM_INSTRUCTION),
                    )
                    if follow_up.text:
                        await send_safe_reply(update, follow_up.text)
                        return

        if response.text:
            await send_safe_reply(update, response.text)
        else:
            await update.message.reply_text("✅ File processed successfully.")

    except Exception as e:
        logger.error(f"Error handling document import: {e}")
        await update.message.reply_text(f"❌ Failed to process file import: {e}")


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
            model=GEMINI_MODEL,
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
                        model=GEMINI_MODEL,
                        contents=f"Tool {fn_name} returned: {tool_res}. Present final response to user.",
                        config=types.GenerateContentConfig(system_instruction=SYSTEM_INSTRUCTION),
                    )
                    if follow_up.text:
                        await send_safe_reply(update, follow_up.text)
                        return

        if response.text:
            await send_safe_reply(update, response.text)
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

    # Fetch OpenAPI spec schema on startup to verify ctracker API connection
    try:
        openapi_res = http_client.get("/openapi.json")
        if openapi_res.status_code == 200:
            logger.info("Successfully connected to ctracker API and retrieved OpenAPI spec!")
        else:
            logger.warning(f"Could not fetch OpenAPI spec (status {openapi_res.status_code})")
    except Exception as e:
        logger.warning(f"Could not connect to ctracker API on startup: {e}")

    logger.info("Starting Calorie & Nutrition Assistant Telegram Bot...")
    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start_handler))
    app.add_handler(CommandHandler("status", status_handler))
    app.add_handler(MessageHandler(filters.Document.ALL, document_handler))
    app.add_handler(MessageHandler(filters.TEXT | filters.PHOTO, message_handler))

    app.run_polling()


if __name__ == "__main__":
    main()

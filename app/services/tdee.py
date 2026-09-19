import math
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from app.config import settings
from app.db.models import UserProfile, ScaleWeight, MealLog, DailySummary

def mifflin_st_jeor(weight_kg: float, height_cm: float, age_years: float, sex: str = "male") -> float:
    s = 5.0 if sex.lower() == "male" else -161.0
    return 10.0 * weight_kg + 6.25 * height_cm - 5.0 * age_years + s

def calculate_age_years(dob_str: str, current_date_str: str) -> float:
    try:
        dob = datetime.strptime(dob_str, "%Y-%m-%d")
        curr = datetime.strptime(current_date_str, "%Y-%m-%d")
        return max(18.0, (curr - dob).days / 365.25)
    except Exception:
        return 38.0

def recalculate_user_tdee(db: Session, username: str):
    profile = db.query(UserProfile).filter(UserProfile.username == username).first()
    if not profile:
        return

    # Fetch all weight logs & food logs sorted by date
    weights_db = db.query(ScaleWeight).filter(ScaleWeight.username == username).order_by(ScaleWeight.date.asc()).all()
    weight_map = {w.date: w.raw_weight for w in weights_db}

    meals_db = db.query(MealLog).filter(MealLog.username == username).all()
    
    # Aggregate daily food macros
    food_days = {}
    for m in meals_db:
        if m.date not in food_days:
            food_days[m.date] = {"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0, "has_log": False}
        food_days[m.date]["calories"] += m.calories
        food_days[m.date]["protein"] += m.protein
        food_days[m.date]["carbs"] += m.carbs
        food_days[m.date]["fat"] += m.fat
        food_days[m.date]["has_log"] = True

    all_dates = sorted(list(set(list(weight_map.keys()) + list(food_days.keys()))))
    if not all_dates:
        return

    # Create full contiguous date range from earliest to latest (or today)
    start_dt = datetime.strptime(all_dates[0], "%Y-%m-%d")
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    end_dt = max(datetime.strptime(all_dates[-1], "%Y-%m-%d"), datetime.strptime(today_str, "%Y-%m-%d"))

    dates_contiguous = []
    curr = start_dt
    while curr <= end_dt:
        dates_contiguous.append(curr.strftime("%Y-%m-%d"))
        curr += timedelta(days=1)

    # Initial BMR & Initial TDEE
    initial_w = weights_db[0].raw_weight if weights_db else 80.0
    age_yr = calculate_age_years(profile.dob, dates_contiguous[0])
    bmr_init = mifflin_st_jeor(initial_w, profile.height_cm, age_yr, profile.sex)
    curr_tdee = bmr_init * profile.activity_multiplier

    curr_tw = initial_w
    last_weight_dt = start_dt

    trend_weights = {}
    calculated_tdees = {}

    for i, dt_str in enumerate(dates_contiguous):
        dt = datetime.strptime(dt_str, "%Y-%m-%d")

        # Update Trend Weight if raw weight logged
        if dt_str in weight_map:
            delta_days = (dt - last_weight_dt).days
            alpha_w = 1.0 - math.exp(-delta_days / settings.TAU_W) if delta_days > 0 else 0.1
            curr_tw = alpha_w * weight_map[dt_str] + (1.0 - alpha_w) * curr_tw
            last_weight_dt = dt
        
        trend_weights[dt_str] = curr_tw

        # Update TDEE over rolling window
        if i >= settings.WINDOW_DAYS:
            window_dates = dates_contiguous[i - settings.WINDOW_DAYS : i]
            valid_intakes = [food_days[d]["calories"] for d in window_dates if d in food_days and food_days[d]["has_log"]]
            
            if len(valid_intakes) >= settings.MIN_FOOD_LOGGED_DAYS:
                avg_intake = sum(valid_intakes) / len(valid_intakes)
                w_change = trend_weights[dt_str] - trend_weights[dates_contiguous[i - settings.WINDOW_DAYS]]
                energy_delta = (w_change * settings.FAT_KCAL_PER_KG) / settings.WINDOW_DAYS
                raw_tdee = avg_intake - energy_delta
                
                alpha_e = 1.0 - math.exp(-1.0 / settings.TAU_E)
                curr_tdee = alpha_e * raw_tdee + (1.0 - alpha_e) * curr_tdee
        
        calculated_tdees[dt_str] = curr_tdee

    # Save trend weight back to scale_weights
    for w_obj in weights_db:
        if w_obj.date in trend_weights:
            w_obj.trend_weight = round(trend_weights[w_obj.date], 2)

    # Daily target calories adjustment based on monthly rate (e.g. -2.0 kg/month -> -506 kcal/day)
    daily_cal_adjustment = (profile.target_monthly_rate_kg * settings.FAT_KCAL_PER_KG) / settings.DAYS_PER_MONTH

    # Upsert DailySummary for all contiguous dates
    for dt_str in dates_contiguous:
        summary = db.query(DailySummary).filter(
            DailySummary.username == username,
            DailySummary.date == dt_str
        ).first()

        if not summary:
            summary = DailySummary(username=username, date=dt_str)
            db.add(summary)

        fd = food_days.get(dt_str, {"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0})
        summary.total_calories = round(fd["calories"], 1)
        summary.total_protein = round(fd["protein"], 1)
        summary.total_carbs = round(fd["carbs"], 1)
        summary.total_fat = round(fd["fat"], 1)
        summary.raw_weight = weight_map.get(dt_str)
        summary.trend_weight = round(trend_weights[dt_str], 2)
        summary.tdee = round(calculated_tdees[dt_str], 1)
        
        raw_target = calculated_tdees[dt_str] + daily_cal_adjustment
        min_floor = profile.min_daily_calories
        
        summary.target_calories = round(max(min_floor, raw_target), 1)
        summary.is_rate_capped_by_safety_floor = raw_target < min_floor

    db.commit()

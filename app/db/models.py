import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, Integer, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db.session import Base

class UserProfile(Base):
    __tablename__ = "user_profiles"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    dob = Column(String, nullable=False, default="1987-12-07")  # YYYY-MM-DD
    height_cm = Column(Float, nullable=False, default=185.0)
    sex = Column(String, nullable=False, default="male")
    activity_multiplier = Column(Float, nullable=False, default=1.61)
    target_rate_kg_per_week = Column(Float, nullable=False, default=-0.5)  # Negative for loss, positive for gain
    protein_ratio = Column(Float, nullable=False, default=0.30)
    carbs_ratio = Column(Float, nullable=False, default=0.40)
    fat_ratio = Column(Float, nullable=False, default=0.30)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class APIKey(Base):
    __tablename__ = "api_keys"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    key = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, ForeignKey("user_profiles.username"), nullable=False)
    name = Column(String, nullable=False, default="Default Key")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ScaleWeight(Base):
    __tablename__ = "scale_weights"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, ForeignKey("user_profiles.username"), nullable=False, index=True)
    date = Column(String, nullable=False, index=True)  # YYYY-MM-DD
    raw_weight = Column(Float, nullable=False)
    trend_weight = Column(Float, nullable=True)
    client_event_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint('username', 'date', name='uix_user_weight_date'),)


class MealLog(Base):
    __tablename__ = "meal_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String, ForeignKey("user_profiles.username"), nullable=False, index=True)
    date = Column(String, nullable=False, index=True)  # YYYY-MM-DD
    time = Column(String, nullable=True)  # HH:MM AM/PM
    food_name = Column(String, nullable=False)
    serving_size = Column(String, nullable=True)
    serving_qty = Column(Float, default=1.0)
    serving_weight_g = Column(Float, nullable=True)
    calories = Column(Float, nullable=False, default=0.0)
    fat = Column(Float, nullable=False, default=0.0)
    carbs = Column(Float, nullable=False, default=0.0)
    protein = Column(Float, nullable=False, default=0.0)
    is_fasted = Column(Boolean, default=False)
    client_event_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ProcessedEvent(Base):
    __tablename__ = "processed_events"

    client_event_id = Column(String, primary_key=True)
    endpoint = Column(String, nullable=False)
    processed_at = Column(DateTime, default=datetime.utcnow)


class DailySummary(Base):
    __tablename__ = "daily_summaries"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, ForeignKey("user_profiles.username"), nullable=False, index=True)
    date = Column(String, nullable=False, index=True)  # YYYY-MM-DD
    total_calories = Column(Float, default=0.0)
    total_protein = Column(Float, default=0.0)
    total_carbs = Column(Float, default=0.0)
    total_fat = Column(Float, default=0.0)
    raw_weight = Column(Float, nullable=True)
    trend_weight = Column(Float, nullable=True)
    tdee = Column(Float, nullable=True)
    target_calories = Column(Float, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint('username', 'date', name='uix_user_summary_date'),)

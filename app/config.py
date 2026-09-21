from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite:///./ctracker.db"
    MASTER_API_KEY: str = "master_secret_key_change_me"
    DEFAULT_USER_DOB: str = "1987-12-07"
    DEFAULT_USER_HEIGHT_CM: float = 185.0
    DEFAULT_USER_SEX: str = "male"

    # TDEE Algorithm & Formula Constants
    TAU_W: float = 14.0  # Weight trend time constant (days)
    TAU_E: float = 28.0  # Expenditure trend time constant (days)
    WINDOW_DAYS: int = 14  # Rolling window size (days)
    MIN_FOOD_LOGGED_DAYS: int = 5  # Data density requirement
    FAT_KCAL_PER_KG: float = 7700.0  # Energy content of fat tissue (kcal/kg)
    DAYS_PER_MONTH: float = 30.4375  # Average days in a month
    DEFAULT_MIN_DAILY_CALORIES: float = 1500.0  # Safety floor default


settings = Settings()

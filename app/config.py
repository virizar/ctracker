from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite:///./ctracker.db"
    MASTER_API_KEY: str = "master_secret_key_change_me"
    GEMINI_API_KEY: str = ""
    DEFAULT_USER_DOB: str = "1987-12-07"
    DEFAULT_USER_HEIGHT_CM: float = 185.0
    DEFAULT_USER_SEX: str = "male"

settings = Settings()

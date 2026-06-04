from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    # API Settings
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8174
    DEBUG: bool = True
    # QA-only mode: enables /qa/* endpoints and the forced-roll seam. NEVER set in production.
    QA_MODE: bool = False
    PROJECT_NAME: str = "DND 5E Platform API"
    VERSION: str = "1.0.0"

    # Database
    DATABASE_URL: str

    # Resterlab Database (for authentication)
    RESTERLAB_DATABASE_URL: str = "postgresql://haoli@localhost/resterlab"

    # JWT Settings
    JWT_SECRET_KEY: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_HOURS: int = 8760  # 1 year (365 days)

    # Redis
    REDIS_URL: str

    # CORS
    # Note: do NOT declare a List[str] field bound to env, as pydantic-settings will
    # try to JSON-decode it from env and crash if value is not JSON.
    CORS_ORIGINS_RAW: str | None = None
    CORS_ORIGINS_DEFAULT: List[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:5177",
        "http://localhost:5178",
        "http://localhost:5179",
        "http://localhost:5180",
        "http://localhost:5181",
        "http://localhost:5182",
        "http://localhost:5183",
        "http://localhost:3000",
        "http://192.168.31.253:5174",
        "https://192.168.31.253:5175",
        "http://192.168.31.12:5174",
        "http://192.168.31.154:5174",
    ]

    def get_cors_origins(self) -> List[str]:
        if not self.CORS_ORIGINS_RAW:
            return self.CORS_ORIGINS_DEFAULT
        parts = [p.strip() for p in self.CORS_ORIGINS_RAW.replace("\n", ",").split(",")]
        return [p for p in parts if p]

    # AI API Defaults
    DEFAULT_AI_API_URL: str = "https://api.openai.com/v1"
    DEFAULT_AI_API_KEY: str = ""

    # Doc2X API
    DOC2X_API_KEY: str = ""
    DOC2X_API_URL: str = "https://v2.doc2x.noedgeai.com/"

    # MinerU OCR API
    MINERU_API_KEY: str = ""
    MINERU_API_URL: str = "https://mineru.net/api/v4"
    MINERU_MODEL_VERSION: str = "pipeline"
    MINERU_LANGUAGE: str = "ch"

    # Mistral OCR API
    MISTRAL_API_KEY: str = ""
    MISTRAL_API_URL: str = "https://api.mistral.ai/v1"

    # Aliyun OSS
    OSS_ACCESS_KEY_ID: str = ""
    OSS_ACCESS_KEY_SECRET: str = ""
    OSS_BUCKET_NAME: str = "deepwood"
    OSS_ENDPOINT: str = "oss-cn-beijing.aliyuncs.com"
    OSS_REGION: str = "cn-beijing"
    OSS_CDN_DOMAIN: str = ""

    # WebSocket
    WS_HEARTBEAT_INTERVAL: int = 30

    # i18n / Locale
    # Canonical default locale for unauthenticated requests and users whose
    # preference is missing or unparseable. The set of accepted locales lives
    # in ``app.core.locale.SUPPORTED_LOCALES``.
    DEFAULT_LOCALE: str = "en-US"

    # LiveKit Voice Server
    LIVEKIT_API_KEY: str = "APIKeyDND"
    LIVEKIT_API_SECRET: str = "DND_Voice_Secret_2024_Secure_Key0"
    LIVEKIT_URL: str = "wss://ws.deepwood.cn/livekit"

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="ignore",  # Ignore extra fields from .env
    )


settings = Settings()

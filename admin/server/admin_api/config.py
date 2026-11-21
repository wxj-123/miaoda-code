import os

from pydantic import model_validator
from pydantic_settings import BaseSettings

# 仅用于本地开发的弱默认值：APP_ENV=prod 时禁止使用（见 _reject_weak_secret_in_prod）
DEV_SECRET_KEY = "eat-what-admin-dev-secret-change-me"
WEAK_SECRET_KEYS = {DEV_SECRET_KEY, "change-me-in-production", "change-me", "your-secret-key", ""}


class Settings(BaseSettings):
    APP_NAME: str = "今天吃什么 · 管理后台 API"
    APP_ENV: str = "dev"

    # 开发默认用 SQLite，生产把 DATABASE_URL 换成 PostgreSQL 即可
    # 例：postgresql+psycopg://user:pwd@127.0.0.1:5432/eat_what
    DATABASE_URL: str = "sqlite:///./admin_dev.db"

    SECRET_KEY: str = DEV_SECRET_KEY
    JWT_ALGORITHM: str = "HS256"
    TOKEN_EXPIRE_MINUTES: int = 8 * 60
    USER_TOKEN_EXPIRE_DAYS: int = 90

    # 小程序微信登录：留空时走开发模式（按设备号派生稳定 uid，仅本地调试可用）
    WX_APPID: str = ""
    WX_SECRET: str = ""

    # 首位小程序审核员认领：必须显式配置允许认领的 uid 列表（逗号分隔）。
    # 留空则彻底关闭 claim-admin，避免空库时任意用户抢注管理员。
    APP_ADMIN_CLAIM_UIDS: str = ""

    # 上传目录与对外访问前缀（生产建议换成对象存储 + CDN 域名）
    UPLOAD_DIR: str = "uploads"
    PUBLIC_BASE_URL: str = ""

    CORS_ORIGINS: str = "*"

    @model_validator(mode="after")
    def _reject_weak_secret_in_prod(self):
        """生产环境禁止用默认/弱密钥，否则任何人都能离线伪造 admin JWT。"""
        if self.APP_ENV.lower() in ("prod", "production", "release"):
            if self.SECRET_KEY in WEAK_SECRET_KEYS or len(self.SECRET_KEY) < 32:
                raise ValueError(
                    "APP_ENV=prod 时必须设置强 SECRET_KEY（≥32 位且非默认值）："
                    "请通过 .env 或环境变量注入"
                )
        return self

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

os.makedirs("logs", exist_ok=True)
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

from datetime import datetime, timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext

from .config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(raw: str) -> str:
    return pwd_context.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(raw, hashed)
    except Exception:
        return False


def create_token(admin_id: int, username: str) -> str:
    payload = {
        "sub": str(admin_id),
        "username": username,
        "scope": "admin",
        "exp": datetime.utcnow() + timedelta(minutes=settings.TOKEN_EXPIRE_MINUTES),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_user_token(uid: str, name: str = "") -> str:
    """小程序用户令牌。和后台令牌同一把密钥，但 scope 不同，互不通用。"""
    payload = {
        "sub": uid,
        "name": name,
        "scope": "user",
        "exp": datetime.utcnow() + timedelta(days=settings.USER_TOKEN_EXPIRE_DAYS),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None

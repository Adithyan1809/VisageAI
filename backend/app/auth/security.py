"""
Core security utilities:
- Password hashing with bcrypt (cost=12)
- JWT access token creation and verification
- Secure refresh token generation (cryptographic random)
- SHA-256 hashing for storing refresh tokens in DB safely
"""
import os
import hashlib
import secrets
import datetime
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Configuration — read from environment
# ---------------------------------------------------------------------------
JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "CHANGE_ME_IN_PRODUCTION_USE_256_BIT_SECRET")
JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
REFRESH_TOKEN_REMEMBER_DAYS: int = int(os.getenv("REFRESH_TOKEN_REMEMBER_DAYS", "30"))

# Max failed logins before account lockout
MAX_FAILED_ATTEMPTS: int = int(os.getenv("MAX_FAILED_ATTEMPTS", "5"))
LOCKOUT_MINUTES: int = int(os.getenv("LOCKOUT_MINUTES", "15"))

# ---------------------------------------------------------------------------
# Password hashing — bcrypt cost=12
# ---------------------------------------------------------------------------
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


def hash_password(plain_password: str) -> str:
    """Hash a plaintext password using bcrypt (cost=12)."""
    return _pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Constant-time bcrypt verification — safe against timing attacks."""
    return _pwd_context.verify(plain_password, hashed_password)


# ---------------------------------------------------------------------------
# JWT Access Token
# ---------------------------------------------------------------------------

def create_access_token(
    subject: str,
    role: str,
    user_id: str,
    expires_delta: Optional[datetime.timedelta] = None,
) -> str:
    """
    Create a signed JWT access token.
    Payload includes: sub (username), role, uid, iat, exp.
    """
    if expires_delta is None:
        expires_delta = datetime.timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    now = datetime.datetime.utcnow()
    expire = now + expires_delta

    payload = {
        "sub": subject,       # username
        "role": role,
        "uid": str(user_id),
        "iat": now,
        "exp": expire,
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """
    Decode and validate a JWT access token.
    Raises JWTError on failure.
    Returns the payload dict on success.
    """
    payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    if payload.get("type") != "access":
        raise JWTError("Invalid token type")
    return payload


# ---------------------------------------------------------------------------
# Refresh Token
# ---------------------------------------------------------------------------

def create_refresh_token() -> str:
    """
    Generate a cryptographically secure random refresh token (64 hex chars = 256 bits).
    This is the raw token returned to the client via httpOnly cookie.
    """
    return secrets.token_hex(32)


def hash_refresh_token(raw_token: str) -> str:
    """
    SHA-256 hash of the raw refresh token — this is what we store in the DB.
    Never store the raw token in the database.
    """
    return hashlib.sha256(raw_token.encode()).hexdigest()


def get_refresh_token_expiry(remember_me: bool = False) -> datetime.datetime:
    """Return expiry datetime for a refresh token."""
    days = REFRESH_TOKEN_REMEMBER_DAYS if remember_me else REFRESH_TOKEN_EXPIRE_DAYS
    return datetime.datetime.utcnow() + datetime.timedelta(days=days)

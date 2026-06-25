"""
Pydantic schemas for authentication API request/response validation.
"""
import uuid
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, EmailStr, field_validator


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str
    remember_me: bool = False  # If True, refresh token gets longer TTL


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one digit")
        return v


class AdminUserCreate(BaseModel):
    username: str
    email: str
    password: str
    full_name: Optional[str] = None
    role: str = "ADMIN"


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds until access token expires


class AdminUserOut(BaseModel):
    id: uuid.UUID
    username: str
    email: str
    full_name: Optional[str]
    role: str
    is_active: bool
    last_login_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}


class MeResponse(BaseModel):
    user: AdminUserOut
    token_expires_in: int  # seconds remaining on access token

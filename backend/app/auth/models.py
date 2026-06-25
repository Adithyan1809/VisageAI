"""
SQLAlchemy ORM models for authentication.
- AdminUser: stores admin accounts with bcrypt-hashed passwords, roles, and lockout info.
- RefreshToken: stores SHA-256 hashes of issued refresh tokens for rotation + revocation.
"""
import uuid
import datetime
from sqlalchemy import (
    Column, String, Boolean, Integer, DateTime, ForeignKey, Text
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.config.database import Base


def _now():
    return datetime.datetime.utcnow()


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)

    # Role: SUPER_ADMIN | ADMIN | VIEWER
    role = Column(String(32), nullable=False, default="ADMIN")

    is_active = Column(Boolean, default=True, nullable=False)

    # Lockout tracking
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime, nullable=True)

    # Timestamps
    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_now, nullable=False)
    updated_at = Column(DateTime, default=_now, onupdate=_now, nullable=False)

    # Relationship
    refresh_tokens = relationship(
        "RefreshToken", back_populates="user", cascade="all, delete-orphan"
    )

    def is_locked(self) -> bool:
        if self.locked_until and self.locked_until > datetime.datetime.utcnow():
            return True
        return False

    def __repr__(self):
        return f"<AdminUser {self.username} role={self.role}>"


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # We store the SHA-256 hash of the actual token — never the raw token in DB
    token_hash = Column(String(64), unique=True, nullable=False, index=True)

    user_id = Column(
        UUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="CASCADE"), nullable=False
    )
    user = relationship("AdminUser", back_populates="refresh_tokens")

    expires_at = Column(DateTime, nullable=False)
    revoked = Column(Boolean, default=False, nullable=False)

    # Audit fields
    created_at = Column(DateTime, default=_now, nullable=False)
    user_agent = Column(Text, nullable=True)
    ip_address = Column(String(64), nullable=True)

    def is_expired(self) -> bool:
        return datetime.datetime.utcnow() > self.expires_at

    def is_valid(self) -> bool:
        return not self.revoked and not self.is_expired()

    def __repr__(self):
        return f"<RefreshToken user_id={self.user_id} revoked={self.revoked}>"

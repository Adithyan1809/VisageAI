"""
FastAPI dependency injection for authentication.
Uses raw SQL to avoid triggering SQLAlchemy ORM mapper configuration
for the legacy broken model relationships in other modules.

Usage:
    @router.get("/protected")
    def protected(user: dict = Depends(get_current_user)):
        ...  # user dict has: id, username, email, role, is_active, full_name

    @router.delete("/admin-only")
    def admin_only(user: dict = Depends(require_admin)):
        ...
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import text
from jose import JWTError

from app.config.session import get_db
from app.auth.security import decode_access_token

_bearer_scheme = HTTPBearer(auto_error=True)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """
    Validate the JWT access token from Authorization: Bearer header.
    Returns a user dict on success; raises HTTP 401 on failure.
    """
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        username: str = payload.get("sub")
        if not username:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Raw SQL query — bypasses ORM mapper configuration
    row = db.execute(
        text("SELECT id, username, email, hashed_password, full_name, role, is_active, "
             "last_login_at, created_at FROM admin_users WHERE username = :username AND is_active = true"),
        {"username": username}
    ).fetchone()

    if row is None:
        raise credentials_exception

    return dict(row._mapping)


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Require ADMIN or SUPER_ADMIN role."""
    if user.get("role") not in ("ADMIN", "SUPER_ADMIN"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions — admin role required",
        )
    return user


def require_super_admin(user: dict = Depends(get_current_user)) -> dict:
    """Require SUPER_ADMIN role only."""
    if user.get("role") != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions — super admin role required",
        )
    return user

"""
Authentication API router — using raw SQL for auth queries to avoid
SQLAlchemy mapper initialization issues from legacy broken relationships
in other modules. The admin_users and refresh_tokens tables are simple
and don't need ORM for the auth endpoints.
"""
import os
import uuid
import datetime
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response, status, Cookie
from sqlalchemy.orm import Session
from sqlalchemy import text
from fastapi import Depends

from app.config.session import get_db
from app.auth.schemas import LoginRequest, TokenResponse, AdminUserOut, ChangePasswordRequest
from app.auth.security import (
    verify_password,
    hash_password,
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
    get_refresh_token_expiry,
    decode_access_token,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    MAX_FAILED_ATTEMPTS,
    LOCKOUT_MINUTES,
)
from jose import JWTError
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger(__name__)

router = APIRouter()

REFRESH_COOKIE_NAME = "visage_refresh_token"
_bearer_scheme = HTTPBearer(auto_error=True)


# ---------------------------------------------------------------------------
# Raw SQL helpers — avoids triggering ORM mapper configuration
# ---------------------------------------------------------------------------

def _get_user_by_username(db: Session, username: str) -> Optional[dict]:
    """Fetch admin user by username using raw SQL."""
    row = db.execute(
        text("SELECT id, username, email, hashed_password, full_name, role, is_active, "
             "failed_login_attempts, locked_until, last_login_at, created_at, updated_at "
             "FROM admin_users WHERE username = :username"),
        {"username": username}
    ).fetchone()
    if row is None:
        return None
    return dict(row._mapping)


def _get_user_by_id(db: Session, user_id: str) -> Optional[dict]:
    """Fetch admin user by id using raw SQL."""
    row = db.execute(
        text("SELECT id, username, email, hashed_password, full_name, role, is_active, "
             "failed_login_attempts, locked_until, last_login_at, created_at, updated_at "
             "FROM admin_users WHERE id = :user_id"),
        {"user_id": str(user_id)}
    ).fetchone()
    if row is None:
        return None
    return dict(row._mapping)


def _is_user_locked(user: dict) -> bool:
    locked_until = user.get("locked_until")
    if locked_until and locked_until > datetime.datetime.utcnow():
        return True
    return False


def _get_refresh_token(db: Session, token_hash: str) -> Optional[dict]:
    row = db.execute(
        text("SELECT id, token_hash, user_id, expires_at, revoked, created_at "
             "FROM refresh_tokens WHERE token_hash = :hash"),
        {"hash": token_hash}
    ).fetchone()
    if row is None:
        return None
    return dict(row._mapping)


def _revoke_refresh_token(db: Session, token_hash: str):
    db.execute(
        text("UPDATE refresh_tokens SET revoked = true WHERE token_hash = :hash"),
        {"hash": token_hash}
    )
    db.commit()


def _revoke_all_tokens_for_user(db: Session, user_id: str):
    db.execute(
        text("UPDATE refresh_tokens SET revoked = true WHERE user_id = :uid"),
        {"uid": str(user_id)}
    )
    db.commit()


def _insert_refresh_token(db: Session, user_id, token_hash: str, expires_at: datetime.datetime,
                          user_agent: str, ip_address: str):
    db.execute(
        text("INSERT INTO refresh_tokens (id, token_hash, user_id, expires_at, revoked, created_at, user_agent, ip_address) "
             "VALUES (:id, :hash, :uid, :exp, false, :now, :ua, :ip)"),
        {
            "id": str(uuid.uuid4()),
            "hash": token_hash,
            "uid": str(user_id),
            "exp": expires_at,
            "now": datetime.datetime.utcnow(),
            "ua": user_agent or "",
            "ip": ip_address or "",
        }
    )
    db.commit()


# ---------------------------------------------------------------------------
# Helper: set httpOnly refresh cookie
# ---------------------------------------------------------------------------
def _set_refresh_cookie(response: Response, raw_token: str, expires_at: datetime.datetime):
    max_age = int((expires_at - datetime.datetime.utcnow()).total_seconds())
    # Set secure=True in production (HTTPS). Configure via COOKIE_SECURE=true in .env
    secure = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_token,
        httponly=True,
        secure=secure,
        samesite="lax",
        max_age=max_age,
        path="/api/auth",
    )


def _clear_refresh_cookie(response: Response):
    response.delete_cookie(key=REFRESH_COOKIE_NAME, path="/api/auth", httponly=True, samesite="lax")


# ---------------------------------------------------------------------------
# Dependency: get_current_user via JWT
# ---------------------------------------------------------------------------
def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """Extract and validate JWT; return user dict."""
    token = credentials.credentials
    creds_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        username: str = payload.get("sub")
        if not username:
            raise creds_exc
    except JWTError:
        raise creds_exc

    user = _get_user_by_username(db, username)
    if user is None or not user["is_active"]:
        raise creds_exc
    return user


# ---------------------------------------------------------------------------
# POST /api/auth/login
# ---------------------------------------------------------------------------
@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    invalid_exc = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    user = _get_user_by_username(db, payload.username)
    if user is None:
        logger.warning(f"Login attempt for non-existent user: {payload.username}")
        raise invalid_exc

    if not user["is_active"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Account is deactivated. Contact your system administrator.")

    if _is_user_locked(user):
        remaining = int((user["locked_until"] - datetime.datetime.utcnow()).total_seconds() // 60)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail=f"Account locked due to too many failed attempts. Try again in {remaining} minutes.")

    if not verify_password(payload.password, user["hashed_password"]):
        new_attempts = user["failed_login_attempts"] + 1
        locked_until = None
        if new_attempts >= MAX_FAILED_ATTEMPTS:
            locked_until = datetime.datetime.utcnow() + datetime.timedelta(minutes=LOCKOUT_MINUTES)
            logger.warning(f"Account locked: {user['username']} after {new_attempts} failed attempts")

        db.execute(
            text("UPDATE admin_users SET failed_login_attempts = :attempts, locked_until = :locked "
                 "WHERE id = :uid"),
            {"attempts": new_attempts, "locked": locked_until, "uid": str(user["id"])}
        )
        db.commit()
        raise invalid_exc

    # Success — reset lockout, update last_login
    db.execute(
        text("UPDATE admin_users SET failed_login_attempts = 0, locked_until = NULL, "
             "last_login_at = :now WHERE id = :uid"),
        {"now": datetime.datetime.utcnow(), "uid": str(user["id"])}
    )
    db.commit()

    access_token = create_access_token(subject=user["username"], role=user["role"], user_id=str(user["id"]))

    raw_refresh = create_refresh_token()
    token_hash = hash_refresh_token(raw_refresh)
    expires_at = get_refresh_token_expiry(remember_me=payload.remember_me)
    _insert_refresh_token(
        db, user["id"], token_hash, expires_at,
        request.headers.get("user-agent", ""),
        request.client.host if request.client else ""
    )
    _set_refresh_cookie(response, raw_refresh, expires_at)

    logger.info(f"Successful login: {user['username']} from {request.client.host if request.client else 'unknown'}")
    return TokenResponse(access_token=access_token, token_type="bearer", expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60)


# ---------------------------------------------------------------------------
# POST /api/auth/refresh
# ---------------------------------------------------------------------------
@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    visage_refresh_token: Optional[str] = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
):
    invalid_exc = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail="Invalid or expired session. Please log in again.")
    if not visage_refresh_token:
        raise invalid_exc

    token_hash = hash_refresh_token(visage_refresh_token)
    rt = _get_refresh_token(db, token_hash)

    if rt is None:
        raise invalid_exc

    if rt["revoked"]:
        logger.warning(f"SECURITY: Revoked refresh token reuse for user_id={rt['user_id']}")
        _revoke_all_tokens_for_user(db, rt["user_id"])
        raise invalid_exc

    if rt["expires_at"] < datetime.datetime.utcnow():
        raise invalid_exc

    user = _get_user_by_id(db, str(rt["user_id"]))
    if user is None or not user["is_active"]:
        raise invalid_exc

    # Rotate: revoke old token, issue new one
    _revoke_refresh_token(db, token_hash)

    access_token = create_access_token(subject=user["username"], role=user["role"], user_id=str(user["id"]))

    raw_refresh = create_refresh_token()
    new_hash = hash_refresh_token(raw_refresh)
    expires_at = rt["expires_at"]  # preserve original expiry
    _insert_refresh_token(
        db, user["id"], new_hash, expires_at,
        request.headers.get("user-agent", ""),
        request.client.host if request.client else ""
    )
    _set_refresh_cookie(response, raw_refresh, expires_at)

    return TokenResponse(access_token=access_token, token_type="bearer", expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60)


# ---------------------------------------------------------------------------
# POST /api/auth/logout
# ---------------------------------------------------------------------------
@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    db: Session = Depends(get_db),
    visage_refresh_token: Optional[str] = Cookie(default=None, alias=REFRESH_COOKIE_NAME),
):
    if visage_refresh_token:
        token_hash = hash_refresh_token(visage_refresh_token)
        _revoke_refresh_token(db, token_hash)
    _clear_refresh_cookie(response)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# GET /api/auth/me
# ---------------------------------------------------------------------------
@router.get("/me", response_model=AdminUserOut)
def me(current_user: dict = Depends(get_current_user)):
    return AdminUserOut(
        id=current_user["id"],
        username=current_user["username"],
        email=current_user["email"],
        full_name=current_user.get("full_name"),
        role=current_user["role"],
        is_active=current_user["is_active"],
        last_login_at=current_user.get("last_login_at"),
        created_at=current_user["created_at"],
    )


# ---------------------------------------------------------------------------
# POST /api/auth/change-password
# ---------------------------------------------------------------------------
@router.post("/change-password", status_code=status.HTTP_200_OK)
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    if not verify_password(payload.current_password, current_user["hashed_password"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    new_hashed = hash_password(payload.new_password)
    db.execute(
        text("UPDATE admin_users SET hashed_password = :h, updated_at = :now WHERE id = :uid"),
        {"h": new_hashed, "now": datetime.datetime.utcnow(), "uid": str(current_user["id"])}
    )
    _revoke_all_tokens_for_user(db, current_user["id"])

    _clear_refresh_cookie(response)
    logger.info(f"Password changed for user: {current_user['username']}")
    return {"detail": "Password changed successfully. Please log in again."}

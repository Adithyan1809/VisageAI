"""
Admin account seeder — run this once to create the first SUPER_ADMIN account.

Usage:
    python -m app.auth.seed
    python -m app.auth.seed --username admin --password MyPass123 --email admin@company.com

It is idempotent: running it again with the same username won't create duplicates.
"""
import sys
import argparse
import datetime

# Ensure project root is in path when run as module
sys.path.insert(0, ".")

from app.config.database import engine, Base
from app.config.session import SessionLocal
from app.auth.models import AdminUser, RefreshToken  # noqa: ensure tables registered
from app.auth.security import hash_password


def seed_admin(username: str, password: str, email: str, full_name: str = "System Administrator"):
    """Create all tables and seed the first admin account if it doesn't already exist."""

    # Create tables (safe — won't drop existing data)
    Base.metadata.create_all(bind=engine)
    print("✓ Auth tables created/verified")

    db = SessionLocal()
    try:
        existing = db.query(AdminUser).filter(AdminUser.username == username).first()
        if existing:
            print(f"⚠  User '{username}' already exists (role={existing.role}). No changes made.")
            return

        admin = AdminUser(
            username=username,
            email=email,
            hashed_password=hash_password(password),
            full_name=full_name,
            role="SUPER_ADMIN",
            is_active=True,
            failed_login_attempts=0,
            created_at=datetime.datetime.utcnow(),
            updated_at=datetime.datetime.utcnow(),
        )
        db.add(admin)
        db.commit()
        print(f"✓ Created SUPER_ADMIN: {username} ({email})")
        print("  → Login at: http://localhost:3000/login")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed the first admin user for VisageAI")
    parser.add_argument("--username", default="admin", help="Admin username (default: admin)")
    parser.add_argument("--password", default="Admin@1234", help="Admin password (default: Admin@1234)")
    parser.add_argument("--email", default="admin@visageai.local", help="Admin email")
    parser.add_argument("--full-name", default="System Administrator", help="Display name")
    args = parser.parse_args()

    seed_admin(
        username=args.username,
        password=args.password,
        email=args.email,
        full_name=args.full_name,
    )

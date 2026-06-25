# app/alerts/models.py
# AlertAction and AuditLog are placeholder stubs — not yet active in the API.
# Relationships to User are declared on the User model but the Alert model is not yet implemented.
# This file intentionally defines only AlertAction and AuditLog without the Alert relationship
# to prevent mapper initialization failures.

from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from ..config.database import Base, get_current_utc


class AlertAction(Base):
    __tablename__ = "alert_actions"
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"))
    action_type = Column(String)
    action_time = Column(DateTime, default=get_current_utc)
    details = Column(String)
    user = relationship("User", back_populates="alert_actions")


class AuditLog(Base):
    __tablename__ = "audit_log"
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"))
    event_type = Column(String)
    event_id = Column(String)
    event_time = Column(DateTime)
    details = Column(String)
    user = relationship("User", back_populates="audit_logs")
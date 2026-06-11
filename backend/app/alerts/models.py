# app/alerts/models.py
# This module is currently unused and no API endpoints reference these alert models.
# Kept for future extensibility but all model definitions have been removed.
    alert = relationship("Alert", back_populates="alert_actions")
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
    alert = relationship("Alert", back_populates="audit_logs")  # Assuming AuditLog links to Alerts too
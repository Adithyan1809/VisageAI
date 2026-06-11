# app/safety/models.py

from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from ..config.database import Base, get_current_utc

class PPEEvent(Base):
    __tablename__ = "ppe_events"
    id = Column(String, primary_key=True)
    employee_id = Column(String, ForeignKey("employees.id"))
    camera_id = Column(String, ForeignKey("cameras.id"))
    event_time = Column(DateTime)
    ppe_type = Column(String)
    compliance_status = Column(String)
    created_at = Column(DateTime, default=get_current_utc)
    employee = relationship("Employee", back_populates="ppe_events")
    camera = relationship("Camera", back_populates="ppe_events")
    reports = relationship("Report", back_populates="ppe_event")
    predictive_models = relationship("PredictiveModel", back_populates="ppe_event")

class FallEvent(Base):
    __tablename__ = "fall_events"
    id = Column(String, primary_key=True)
    employee_id = Column(String, ForeignKey("employees.id"))
    camera_id = Column(String, ForeignKey("cameras.id"))
    event_time = Column(DateTime)
    severity = Column(String)
    created_at = Column(DateTime, default=get_current_utc)
    employee = relationship("Employee", back_populates="fall_events")
    camera = relationship("Camera", back_populates="fall_events")
    reports = relationship("Report", back_populates="fall_event")
    predictive_models = relationship("PredictiveModel", back_populates="fall_event")

class MusterEvent(Base):
    __tablename__ = "muster_events"
    id = Column(String, primary_key=True)
    event_time = Column(DateTime)
    site_id = Column(String, ForeignKey("sites.id"))
    zone_id = Column(String, ForeignKey("zones.id"))
    summary = Column(String)
    created_at = Column(DateTime, default=get_current_utc)
    site = relationship("Site", back_populates="muster_events")
    zone = relationship("Zone", back_populates="muster_events")
    employees_assoc = relationship("MusterEventEmployee", back_populates="muster_event")

class MusterEventEmployee(Base):
    __tablename__ = "muster_event_employees"
    id = Column(String, primary_key=True)
    muster_event_id = Column(String, ForeignKey("muster_events.id"))
    employee_id = Column(String, ForeignKey("employees.id"))
    muster_event = relationship("MusterEvent", back_populates="employees_assoc")
    employee = relationship("Employee", back_populates="muster_event_assocs")

class IntrusionEvent(Base):
    __tablename__ = "intrusion_events"
    id = Column(String, primary_key=True)
    camera_id = Column(String, ForeignKey("cameras.id"))
    person_id = Column(String)
    person_type = Column(String)
    blacklist_id = Column(String, ForeignKey("blacklist.id"))
    event_time = Column(DateTime)
    severity = Column(String)
    created_at = Column(DateTime, default=get_current_utc)
    camera = relationship("Camera", back_populates="intrusion_events")
    blacklist_entry = relationship("Blacklist", back_populates="intrusion_events")
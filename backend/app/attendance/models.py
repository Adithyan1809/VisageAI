# app/attendance/models.py

from sqlalchemy import Column, String, Integer, Float, Boolean, Date, Time, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from ..config.database import Base, get_current_utc

class Shift(Base):
    __tablename__ = "shifts"
    id = Column(String, primary_key=True)
    name = Column(String)
    start_time = Column(Time)
    end_time = Column(Time)
    site_id = Column(String, ForeignKey("sites.id"))
    created_at = Column(DateTime, default=get_current_utc)
    site = relationship("Site", back_populates="shifts")
    shift_assignments = relationship("ShiftAssignment", back_populates="shift")
    attendance_events = relationship("AttendanceEvent", back_populates="shift")
    shift_compliance_logs = relationship("ShiftComplianceLog", back_populates="shift")
    overtime_records = relationship("OvertimeRecord", back_populates="shift")

class ShiftAssignment(Base):
    __tablename__ = "shift_assignments"
    id = Column(String, primary_key=True)
    employee_id = Column(String, ForeignKey("employees.id"))
    shift_id = Column(String, ForeignKey("shifts.id"))
    department_id = Column(String, ForeignKey("departments.id"))
    site_id = Column(String, ForeignKey("sites.id"))
    zone_id = Column(String, ForeignKey("zones.id"))
    assigned_from = Column(Date)
    assigned_to = Column(Date)
    version = Column(Integer)
    is_active = Column(Boolean)
    created_at = Column(DateTime, default=get_current_utc)
    employee = relationship("Employee", back_populates="shift_assignments")
    shift = relationship("Shift", back_populates="shift_assignments")
    department = relationship("Department", back_populates="shift_assignments")
    site = relationship("Site", back_populates="shift_assignments")
    zone = relationship("Zone", back_populates="shift_assignments")

class AttendanceEvent(Base):
    __tablename__ = "attendance_events"
    id = Column(String, primary_key=True)
    employee_id = Column(String, ForeignKey("employees.id"))
    camera_id = Column(String, ForeignKey("cameras.id"))
    zone_id = Column(String, ForeignKey("zones.id"))
    shift_id = Column(String, ForeignKey("shifts.id"))
    event_type = Column(String)
    event_time = Column(DateTime)
    verified_by = Column(String)
    created_at = Column(DateTime, default=get_current_utc)
    employee = relationship("Employee", back_populates="attendance_events")
    camera = relationship("Camera", back_populates="attendance_events")
    zone = relationship("Zone", back_populates="attendance_events")
    shift = relationship("Shift", back_populates="attendance_events")
    project_mappings = relationship("ProjectMapping", back_populates="attendance_event")
    reports = relationship("Report", back_populates="attendance_event")
    predictive_models = relationship("PredictiveModel", back_populates="attendance_event")

class ShiftComplianceLog(Base):
    __tablename__ = "shift_compliance_logs"
    id = Column(String, primary_key=True)
    employee_id = Column(String, ForeignKey("employees.id"))
    shift_id = Column(String, ForeignKey("shifts.id"))
    compliance_status = Column(String)
    violation_type = Column(String)
    event_time = Column(DateTime)
    created_at = Column(DateTime, default=get_current_utc)
    employee = relationship("Employee", back_populates="shift_compliance_logs")
    shift = relationship("Shift", back_populates="shift_compliance_logs")

class OvertimeRecord(Base):
    __tablename__ = "overtime_records"
    id = Column(String, primary_key=True)
    employee_id = Column(String, ForeignKey("employees.id"))
    shift_id = Column(String, ForeignKey("shifts.id"))
    overtime_hours = Column(Float)
    reason = Column(String)
    created_at = Column(DateTime, default=get_current_utc)
    employee = relationship("Employee", back_populates="overtime_records")
    shift = relationship("Shift", back_populates="overtime_records")
    reports = relationship("Report", back_populates="overtime_record")
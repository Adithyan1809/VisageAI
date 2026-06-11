# app/analytics/models.py

from sqlalchemy import Column, String, Integer, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from ..config.database import Base, get_current_utc


class Report(Base):
    __tablename__ = "reports"
    id = Column(String, primary_key=True)
    report_type = Column(String)
    generated_on = Column(DateTime)
    parameters = Column(String)
    summary = Column(String)

    # FKs to multiple different event types
    attendance_event_id = Column(String, ForeignKey("attendance_events.id"))
    ppe_event_id = Column(String, ForeignKey("ppe_events.id"))
    overtime_record_id = Column(String, ForeignKey("overtime_records.id"))

    attendance_event = relationship("AttendanceEvent", back_populates="reports")
    ppe_event = relationship("PPEEvent", back_populates="reports")
    overtime_record = relationship("OvertimeRecord", back_populates="reports")


class PredictiveModel(Base):
    __tablename__ = "predictive_models"
    id = Column(String, primary_key=True)
    model_name = Column(String)
    model_version = Column(String)
    trained_on = Column(DateTime)
    training_data_source = Column(String)
    description = Column(String)

    # FKs to multiple different event types
    attendance_event_id = Column(String, ForeignKey("attendance_events.id"))
    ppe_event_id = Column(String, ForeignKey("ppe_events.id"))

    attendance_event = relationship("AttendanceEvent", back_populates="predictive_models")
    ppe_event = relationship("PPEEvent", back_populates="predictive_models")


class OccupancyMetric(Base):
    __tablename__ = "occupancy_metrics"
    id = Column(String, primary_key=True)
    zone_id = Column(String, ForeignKey("zones.id"))
    site_id = Column(String, ForeignKey("sites.id"))
    metric_date = Column(Date)
    occupancy_count = Column(Integer)
    created_at = Column(DateTime, default=get_current_utc)
    zone = relationship("Zone", back_populates="occupancy_metrics")
    site = relationship("Site", back_populates="occupancy_metrics")
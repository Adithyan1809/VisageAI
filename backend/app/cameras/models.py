# app/cameras/models.py

from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from ..config.database import Base, get_current_utc


class NVRDVR(Base):
    __tablename__ = "nvr_dvr"
    id = Column(String, primary_key=True)
    name = Column(String)
    ip_address = Column(String)
    model = Column(String)
    site_id = Column(String, ForeignKey("sites.id"))
    created_at = Column(DateTime, default=get_current_utc)
    cameras = relationship("Camera", back_populates="nvr_dvr")
    site = relationship("Site", back_populates="nvr_dvrs")


class Camera(Base):
    __tablename__ = "cameras"
    id = Column(String, primary_key=True)
    nvr_dvr_id = Column(String, ForeignKey("nvr_dvr.id"))
    zone_id = Column(String, ForeignKey("zones.id"))
    device_config_id = Column(String, ForeignKey("device_config.id"))
    name = Column(String)
    camera_type = Column(String)
    status = Column(String)
    created_at = Column(DateTime, default=get_current_utc)
    nvr_dvr = relationship("NVRDVR", back_populates="cameras")
    zone = relationship("Zone", back_populates="cameras")
    # explicit foreign_keys and uselist=False to disambiguate the one-to-one relationship
    device_config = relationship("DeviceConfig", back_populates="camera", foreign_keys=[device_config_id], uselist=False)
    access_points = relationship("AccessPoint", back_populates="camera")

    # Relationships to models defined in other files (using string references)
    attendance_events = relationship("AttendanceEvent", back_populates="camera")
    ppe_events = relationship("PPEEvent", back_populates="camera")
    fall_events = relationship("FallEvent", back_populates="camera")
    intrusion_events = relationship("IntrusionEvent", back_populates="camera")
    vehicle_events = relationship("VehicleEvent", back_populates="camera")


class DeviceConfig(Base):
    __tablename__ = "device_config"
    id = Column(String, primary_key=True)
    camera_id = Column(String, ForeignKey("cameras.id"))
    config_data = Column(String)
    version = Column(Integer)
    effective_from = Column(DateTime)
    effective_to = Column(DateTime)
    is_active = Column(Boolean)
    created_at = Column(DateTime, default=get_current_utc)
    # viewonly=True: Camera owns the FK (device_config_id), this is just a convenience accessor
    camera = relationship("Camera", foreign_keys=[camera_id], uselist=False, viewonly=True)


class AccessPoint(Base):
    __tablename__ = "access_points"
    id = Column(String, primary_key=True)
    name = Column(String)
    location = Column(String)
    camera_id = Column(String, ForeignKey("cameras.id"))
    site_id = Column(String, ForeignKey("sites.id"))
    zone_id = Column(String, ForeignKey("zones.id"))
    created_at = Column(DateTime, default=get_current_utc)
    camera = relationship("Camera", back_populates="access_points")
    site = relationship("Site", back_populates="access_points")
    zone = relationship("Zone", back_populates="access_points")
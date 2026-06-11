# app/vehicles/models.py

from sqlalchemy import Column, String, Integer, Boolean, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from ..config.database import Base, get_current_utc


class Vehicle(Base):
    __tablename__ = "vehicles"
    id = Column(String, primary_key=True)
    owner_id = Column(String)  # Not an explicit FK column in SQL, but linked via relationship
    owner_type = Column(String)
    license_plate = Column(String)
    make = Column(String)
    model = Column(String)
    color = Column(String)
    status = Column(String)
    created_at = Column(DateTime, default=get_current_utc)

    # ⭐️ CRITICAL: Multiple relationships to the same base column (owner_id) require foreign_keys
    employee_owner = relationship("Employee", back_populates="vehicles", foreign_keys='Employee.vehicles')
    visitor_owner = relationship("Visitor", back_populates="vehicles", foreign_keys='Visitor.vehicles')

    vehicle_events = relationship("VehicleEvent", back_populates="vehicle")
    vehicle_authorizations = relationship("VehicleAuthorization", back_populates="vehicle")


class VehicleEvent(Base):
    __tablename__ = "vehicle_events"
    id = Column(String, primary_key=True)
    vehicle_id = Column(String, ForeignKey("vehicles.id"))
    camera_id = Column(String, ForeignKey("cameras.id"))
    event_time = Column(DateTime)
    event_type = Column(String)
    zone_id = Column(String, ForeignKey("zones.id"))
    site_id = Column(String, ForeignKey("sites.id"))
    created_at = Column(DateTime, default=get_current_utc)
    vehicle = relationship("Vehicle", back_populates="vehicle_events")
    camera = relationship("Camera", back_populates="vehicle_events")
    zone = relationship("Zone", back_populates="vehicle_events")
    site = relationship("Site", back_populates="vehicle_events")


class VehicleAuthorization(Base):
    __tablename__ = "vehicle_authorizations"
    id = Column(String, primary_key=True)
    vehicle_id = Column(String, ForeignKey("vehicles.id"))
    zone_id = Column(String, ForeignKey("zones.id"))
    site_id = Column(String, ForeignKey("sites.id"))
    valid_from = Column(Date)
    valid_to = Column(Date)
    revoked_on = Column(Date)
    version = Column(Integer)
    is_active = Column(Boolean)
    created_at = Column(DateTime, default=get_current_utc)
    vehicle = relationship("Vehicle", back_populates="vehicle_authorizations")
    zone = relationship("Zone", back_populates="vehicle_authorizations")
    site = relationship("Site", back_populates="vehicle_authorizations")
# app/organization/models.py

from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from ..config.database import Base, get_current_utc

class Organization(Base):
    __tablename__ = "organization"
    id = Column(String, primary_key=True)
    name = Column(String)
    address = Column(String)
    external_org_code = Column(String)
    created_at = Column(DateTime, default=get_current_utc)
    departments = relationship("Department", back_populates="organization")
    sites = relationship("Site", back_populates="organization")

class Department(Base):
    __tablename__ = "departments"
    id = Column(String, primary_key=True)
    organization_id = Column(String, ForeignKey("organization.id"))
    name = Column(String)
    external_department_code = Column(String)
    created_at = Column(DateTime, default=get_current_utc)
    organization = relationship("Organization", back_populates="departments")
    employees = relationship("Employee", back_populates="department")
    shift_assignments = relationship("ShiftAssignment", back_populates="department")

class Site(Base):
    __tablename__ = "sites"
    id = Column(String, primary_key=True)
    organization_id = Column(String, ForeignKey("organization.id"))
    name = Column(String)
    address = Column(String)
    created_at = Column(DateTime, default=get_current_utc)
    organization = relationship("Organization", back_populates="sites")
    zones = relationship("Zone", back_populates="site")
    employees = relationship("Employee", back_populates="site")
    shifts = relationship("Shift", back_populates="site")
    access_points = relationship("AccessPoint", back_populates="site")
    muster_events = relationship("MusterEvent", back_populates="site")
    vehicle_events = relationship("VehicleEvent", back_populates="site")
    vehicle_authorizations = relationship("VehicleAuthorization", back_populates="site")
    nvr_dvrs = relationship("NVRDVR", back_populates="site")
    shift_assignments = relationship("ShiftAssignment", back_populates="site")
    occupancy_metrics = relationship("OccupancyMetric", back_populates="site")

class Zone(Base):
    __tablename__ = "zones"
    id = Column(String, primary_key=True)
    site_id = Column(String, ForeignKey("sites.id"))
    name = Column(String)
    location_description = Column(String)
    created_at = Column(DateTime, default=get_current_utc)
    site = relationship("Site", back_populates="zones")
    employees = relationship("Employee", back_populates="zone")
    cameras = relationship("Camera", back_populates="zone")
    access_points = relationship("AccessPoint", back_populates="zone")
    muster_events = relationship("MusterEvent", back_populates="zone")
    shift_assignments = relationship("ShiftAssignment", back_populates="zone")
    attendance_events = relationship("AttendanceEvent", back_populates="zone")
    vehicle_events = relationship("VehicleEvent", back_populates="zone")
    vehicle_authorizations = relationship("VehicleAuthorization", back_populates="zone")
    occupancy_metrics = relationship("OccupancyMetric", back_populates="zone")
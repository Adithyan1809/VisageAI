# app/identity_access/models.py

from sqlalchemy import Column, String, Integer, Boolean, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from ..config.database import Base, get_current_utc


class Role(Base):
    __tablename__ = "roles"
    id = Column(String, primary_key=True)
    name = Column(String)
    description = Column(String)
    effective_from = Column(Date)
    effective_to = Column(Date)
    is_active = Column(Boolean)
    role_permissions = relationship("RolePermission", back_populates="role")
    users = relationship("User", back_populates="role")


class Permission(Base):
    __tablename__ = "permissions"
    id = Column(String, primary_key=True)
    name = Column(String)
    description = Column(String)
    role_permissions = relationship("RolePermission", back_populates="permission")


class RolePermission(Base):
    __tablename__ = "role_permission"
    id = Column(String, primary_key=True)
    role_id = Column(String, ForeignKey("roles.id"))
    permission_id = Column(String, ForeignKey("permissions.id"))
    effective_from = Column(Date)
    effective_to = Column(Date)
    is_active = Column(Boolean)
    role = relationship("Role", back_populates="role_permissions")
    permission = relationship("Permission", back_populates="role_permissions")


class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True)
    username = Column(String)
    password_hash = Column(String)
    email = Column(String)
    phone = Column(String)
    role_id = Column(String, ForeignKey("roles.id"))
    person_type = Column(String)
    status_flag = Column(String)
    created_at = Column(DateTime, default=get_current_utc)
    updated_at = Column(DateTime, default=get_current_utc, onupdate=get_current_utc)
    role = relationship("Role", back_populates="users")
    employee = relationship("Employee", back_populates="user", uselist=False)
    visitor = relationship("Visitor", back_populates="user", uselist=False)

    alert_actions = relationship("AlertAction", back_populates="user")
    audit_logs = relationship("AuditLog", back_populates="user")


class Employee(Base):
    __tablename__ = "employees"
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"))
    employee_code = Column(String)
    name = Column(String)
    department_id = Column(String, ForeignKey("departments.id"))
    site_id = Column(String, ForeignKey("sites.id"))
    zone_id = Column(String, ForeignKey("zones.id"))
    status_flag = Column(String)
    external_employee_id = Column(String)
    created_at = Column(DateTime, default=get_current_utc)
    updated_at = Column(DateTime, default=get_current_utc, onupdate=get_current_utc)

    # Relationships to models defined in other files (using string references)
    user = relationship("User", back_populates="employee")
    department = relationship("Department", back_populates="employees")
    site = relationship("Site", back_populates="employees")
    zone = relationship("Zone", back_populates="employees")
    facial_templates = relationship("FacialTemplate", back_populates="employee")
    shift_assignments = relationship("ShiftAssignment", back_populates="employee")
    attendance_events = relationship("AttendanceEvent", back_populates="employee")
    shift_compliance_logs = relationship("ShiftComplianceLog", back_populates="employee")
    overtime_records = relationship("OvertimeRecord", back_populates="employee")
    ppe_events = relationship("PPEEvent", back_populates="employee")
    fall_events = relationship("FallEvent", back_populates="employee")
    muster_event_assocs = relationship("MusterEventEmployee", back_populates="employee")

    # Foreign Keys with multiple relationship paths (Vehicle)
    vehicles = relationship("Vehicle", back_populates="employee_owner", foreign_keys='Vehicle.owner_id')


class Visitor(Base):
    __tablename__ = "visitors"
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"))
    visit_reason = Column(String)
    status_flag = Column(String)
    created_at = Column(DateTime, default=get_current_utc)
    updated_at = Column(DateTime, default=get_current_utc, onupdate=get_current_utc)
    user = relationship("User", back_populates="visitor")
    facial_templates = relationship("FacialTemplate", back_populates="visitor")
    vehicles = relationship("Vehicle", back_populates="visitor_owner", foreign_keys='Vehicle.owner_id')


class Blacklist(Base):
    __tablename__ = "blacklist"
    id = Column(String, primary_key=True)
    person_id = Column(String)
    person_type = Column(String)
    reason = Column(String)
    blacklisted_on = Column(DateTime)
    revoked_on = Column(DateTime)
    status = Column(String)
    intrusion_events = relationship("IntrusionEvent", back_populates="blacklist_entry")


class FacialTemplate(Base):
    __tablename__ = "facial_templates"
    id = Column(String, primary_key=True)
    person_id = Column(String)
    person_type = Column(String)
    template_data = Column(String)
    version = Column(Integer)
    model_version = Column(String)
    created_at = Column(DateTime)
    effective_from = Column(DateTime)
    effective_to = Column(DateTime)
    is_active = Column(Boolean)
    employee_id = Column(String, ForeignKey("employees.id"))
    visitor_id = Column(String, ForeignKey("visitors.id"))
    employee = relationship("Employee", back_populates="facial_templates")
    visitor = relationship("Visitor", back_populates="facial_templates")
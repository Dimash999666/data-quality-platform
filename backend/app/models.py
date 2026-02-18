from sqlalchemy import Column, Integer, String, DateTime, JSON, Float, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base
from sqlalchemy.orm import relationship, backref

class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    version = Column(Integer, default=1)
    file_path = Column(String, nullable=False)
    upload_date = Column(DateTime, default=datetime.utcnow)
    total_rows = Column(Integer)
    total_columns = Column(Integer)
    parent_id = Column(Integer, ForeignKey("datasets.id"), nullable=True)

    # Связи
    profiles = relationship("QualityProfile", back_populates="dataset")
    rules = relationship("ValidationRule", back_populates="dataset")
    issues = relationship("QualityIssue", back_populates="dataset")
    versions = relationship("Dataset", backref=backref("parent", remote_side=[id]))


class QualityProfile(Base):
    __tablename__ = "quality_profiles"

    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    # JSON с метриками
    metrics = Column(JSON)  # missing_values, duplicates, dtypes, ranges и т.д.
    quality_score = Column(Float)

    dataset = relationship("Dataset", back_populates="profiles")


class ValidationRule(Base):
    __tablename__ = "validation_rules"

    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id"))
    column_name = Column(String, nullable=False)
    rule_type = Column(String, nullable=False)  # not_null, range, unique, regex
    parameters = Column(JSON)  # {"min": 0, "max": 100}
    created_at = Column(DateTime, default=datetime.utcnow)

    dataset = relationship("Dataset", back_populates="rules")


class QualityIssue(Base):
    __tablename__ = "quality_issues"

    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id"))
    issue_type = Column(String, nullable=False)  # missing_values, outliers, duplicates
    severity = Column(String, nullable=False)  # low, medium, high
    column_name = Column(String)
    description = Column(String)
    affected_rows = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)

    dataset = relationship("Dataset", back_populates="issues")
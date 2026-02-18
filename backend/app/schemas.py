from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Dict, List, Any


class DatasetCreate(BaseModel):
    name: str


class DatasetResponse(BaseModel):
    id: int
    name: str
    version: int
    upload_date: datetime
    total_rows: Optional[int]
    total_columns: Optional[int]

    class Config:
        from_attributes = True


class QualityProfileResponse(BaseModel):
    id: int
    dataset_id: int
    created_at: datetime
    metrics: Dict[str, Any]
    quality_score: Optional[float]

    class Config:
        from_attributes = True


class ValidationRuleCreate(BaseModel):
    column_name: str
    rule_type: str  # not_null, range, unique, regex
    parameters: Optional[Dict[str, Any]] = {}


class ValidationRuleResponse(BaseModel):
    id: int
    column_name: str
    rule_type: str
    parameters: Dict[str, Any]

    class Config:
        from_attributes = True


class IssueResponse(BaseModel):
    id: int
    issue_type: str
    severity: str
    column_name: Optional[str]
    description: str
    affected_rows: Optional[int]

    class Config:
        from_attributes = True
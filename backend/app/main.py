from fastapi import FastAPI, UploadFile, File, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import shutil
import os
import pandas as pd
from pathlib import Path
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi import Request
from .security import (
    validate_file_extension, validate_file_size,
    sanitize_filename, scan_csv_content,
    compute_file_hash, validate_csv_structure
)
from starlette.middleware.base import BaseHTTPMiddleware

MAX_FILE_SIZE_MB = 100

from . import models, schemas
from .database import engine, get_db
from .profiler import profile_dataset, detect_anomalies, calculate_quality_score, detect_issues
from .ai_agent import analyze_quality, suggest_rules, explain_issue
from .comparator import compare_versions, calculate_drift_score

# Создаём таблицы
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Data Quality Platform")

# Rate Limiter
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://frontend:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# Директория для загрузок
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/data/uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@app.get("/")
def read_root():
    return {"message": "Data Quality Platform API", "status": "running"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.post("/datasets/upload", response_model=schemas.DatasetResponse)
@limiter.limit("10/minute")  # Максимум 10 загрузок в минуту
async def upload_dataset(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Загрузка датасета с security проверками"""

    # 1. Проверка расширения
    if not validate_file_extension(file.filename):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Invalid file type",
                "reason": f"File '{file.filename}' is not a CSV file",
                "explanation": "Only .csv files are supported",
                "how_to_fix": "Save your file as CSV format and try again"
            }
        )

    # 2. Читаем содержимое
    content = await file.read()

    # 3. Проверка размера
    if not validate_file_size(content):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "File too large",
                "reason": f"File size exceeds {MAX_FILE_SIZE_MB}MB limit",
                "explanation": f"Maximum allowed file size is {MAX_FILE_SIZE_MB}MB",
                "how_to_fix": "Split your file into smaller parts and upload separately"
            }
        )

    # 4. Проверка структуры CSV
    structure = validate_csv_structure(content)
    if not structure["valid"]:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Invalid CSV structure",
                "reason": structure["reason"],
                "explanation": "The file does not appear to be a valid CSV",
                "how_to_fix": (
                    "Make sure your file: "
                    "1) Has a header row, "
                    "2) Has at least one data row, "
                    "3) Uses comma as separator, "
                    "4) Is saved in UTF-8 encoding"
                )
            }
        )

    # 5. Сканирование на опасный контент
    scan = scan_csv_content(content)
    if not scan["safe"]:
        # Формируем понятное объяснение
        details = []
        for issue in scan["issues"]:
            details.append(
                f"Row {issue['line']}, column {issue['cell']}: "
                f"'{issue['value']}' looks like a dangerous formula or script"
            )

        raise HTTPException(
            status_code=400,
            detail={
                "error": "Security check failed",
                "reason": "Your CSV file contains potentially dangerous content",
                "explanation": (
                    "CSV files can contain formula injections (e.g. =SUM(), +cmd) "
                    "or scripts (<script>, javascript:) that could be harmful. "
                    "Please remove these values and try again."
                ),
                "found_issues": details,
                "how_to_fix": (
                    "Remove or replace values starting with =FORMULA(), "
                    "+cmd|, @FORMULA(), <script>, or javascript:"
                )
            }
        )

    # 6. Безопасное имя файла
    safe_filename = sanitize_filename(file.filename)

    # 7. Дедупликация по хешу
    file_hash = compute_file_hash(content)

    # 8. Сохраняем файл
    file_path = UPLOAD_DIR / safe_filename
    with open(file_path, "wb") as f:
        f.write(content)

    # 9. Создаём запись в БД
    import pandas as pd
    df = pd.read_csv(file_path)

    dataset = models.Dataset(
        name=safe_filename,
        file_path=str(file_path),
        total_rows=len(df),
        total_columns=len(df.columns)
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)

    return dataset


@app.get("/datasets", response_model=list[schemas.DatasetResponse])
def get_datasets(db: Session = Depends(get_db)):
    """Получить список всех датасетов"""
    datasets = db.query(models.Dataset).all()
    return datasets


@app.get("/datasets/{dataset_id}", response_model=schemas.DatasetResponse)
def get_dataset(dataset_id: int, db: Session = Depends(get_db)):
    """Получить конкретный датасет"""
    dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


@app.post("/datasets/{dataset_id}/profile")
def create_profile(dataset_id: int, db: Session = Depends(get_db)):
    """Запустить анализ качества датасета"""

    # Находим датасет
    dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Читаем CSV
    import pandas as pd
    df = pd.read_csv(dataset.file_path)

    # Анализируем
    profile = profile_dataset(df)
    anomalies = detect_anomalies(df)
    quality_score = calculate_quality_score(profile, anomalies)
    issues = detect_issues(profile, anomalies)

    # Сохраняем профиль в БД
    db_profile = models.QualityProfile(
        dataset_id=dataset_id,
        metrics={
            "profile": profile,
            "anomalies": anomalies
        },
        quality_score=quality_score
    )
    db.add(db_profile)

    # Сохраняем проблемы в БД
    for issue in issues:
        db_issue = models.QualityIssue(
            dataset_id=dataset_id,
            **issue
        )
        db.add(db_issue)

    db.commit()
    db.refresh(db_profile)

    return {
        "dataset_id": dataset_id,
        "quality_score": quality_score,
        "profile": profile,
        "anomalies": anomalies,
        "issues": issues
    }


@app.get("/datasets/{dataset_id}/profile")
def get_profile(dataset_id: int, db: Session = Depends(get_db)):
    """Получить последний профиль качества"""

    profile = db.query(models.QualityProfile) \
        .filter(models.QualityProfile.dataset_id == dataset_id) \
        .order_by(models.QualityProfile.created_at.desc()) \
        .first()

    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found. Run POST /profile first.")

    return {
        "dataset_id": dataset_id,
        "quality_score": profile.quality_score,
        "created_at": profile.created_at,
        "metrics": profile.metrics
    }


@app.get("/datasets/{dataset_id}/issues")
def get_issues(dataset_id: int, db: Session = Depends(get_db)):
    """Получить список проблем датасета"""

    issues = db.query(models.QualityIssue) \
        .filter(models.QualityIssue.dataset_id == dataset_id) \
        .all()

    return {
        "dataset_id": dataset_id,
        "total_issues": len(issues),
        "issues": [
            {
                "id": i.id,
                "type": i.issue_type,
                "severity": i.severity,
                "column": i.column_name,
                "description": i.description,
                "affected_rows": i.affected_rows
            }
            for i in issues
        ]
    }
@app.post("/datasets/{dataset_id}/ai-analyze")
def ai_analyze_dataset(dataset_id: int, db: Session = Depends(get_db)):
    """AI агент анализирует датасет и даёт рекомендации"""

    # Получаем последний профиль
    profile_record = db.query(models.QualityProfile)\
        .filter(models.QualityProfile.dataset_id == dataset_id)\
        .order_by(models.QualityProfile.created_at.desc())\
        .first()

    if not profile_record:
        raise HTTPException(
            status_code=404,
            detail="Run POST /datasets/{id}/profile first!"
        )

    # Получаем issues
    issues = db.query(models.QualityIssue)\
        .filter(models.QualityIssue.dataset_id == dataset_id)\
        .all()

    issues_list = [
        {
            "type": i.issue_type,
            "severity": i.severity,
            "column": i.column_name,
            "description": i.description,
            "affected_rows": i.affected_rows
        }
        for i in issues
    ]

    # Вызываем AI агента
    profile_data = profile_record.metrics.get("profile", {})
    ai_result = analyze_quality(
        profile=profile_data,
        issues=issues_list,
        quality_score=profile_record.quality_score
    )

    return {
        "dataset_id": dataset_id,
        "quality_score": profile_record.quality_score,
        "ai_analysis": ai_result
    }


@app.post("/datasets/{dataset_id}/ai-suggest-rules/{column_name}")
def ai_suggest_column_rules(
    dataset_id: int,
    column_name: str,
    db: Session = Depends(get_db)
):
    """AI предлагает правила валидации для конкретной колонки"""

    dataset = db.query(models.Dataset)\
        .filter(models.Dataset.id == dataset_id).first()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    import pandas as pd
    df = pd.read_csv(dataset.file_path)

    if column_name not in df.columns:
        raise HTTPException(status_code=404, detail=f"Column '{column_name}' not found")

    # Собираем информацию о колонке
    sample_values = df[column_name].dropna().head(10).tolist()
    dtype = str(df[column_name].dtype)

    stats = None
    if df[column_name].dtype in ['int64', 'float64']:
        stats = {
            "min": float(df[column_name].min()),
            "max": float(df[column_name].max()),
            "mean": float(df[column_name].mean())
        }

    result = suggest_rules(column_name, sample_values, dtype, stats)

    return {
        "dataset_id": dataset_id,
        "column": column_name,
        "suggested_rules": result
    }

@app.post("/datasets/{dataset_id}/rules")
def add_validation_rule(
    dataset_id: int,
    rule: schemas.ValidationRuleCreate,
    db: Session = Depends(get_db)
):
    """Добавить правило валидации"""

    dataset = db.query(models.Dataset)\
        .filter(models.Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    db_rule = models.ValidationRule(
        dataset_id=dataset_id,
        column_name=rule.column_name,
        rule_type=rule.rule_type,
        parameters=rule.parameters
    )
    db.add(db_rule)
    db.commit()
    db.refresh(db_rule)

    return db_rule


@app.get("/datasets/{dataset_id}/rules")
def get_rules(dataset_id: int, db: Session = Depends(get_db)):
    """Получить все правила датасета"""

    rules = db.query(models.ValidationRule)\
        .filter(models.ValidationRule.dataset_id == dataset_id).all()

    return {"dataset_id": dataset_id, "rules": rules}


@app.post("/datasets/{dataset_id}/validate")
def validate_dataset(dataset_id: int, db: Session = Depends(get_db)):
    """Выполнить валидацию датасета по всем правилам"""

    dataset = db.query(models.Dataset) \
        .filter(models.Dataset.id == dataset_id).first()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    rules = db.query(models.ValidationRule) \
        .filter(models.ValidationRule.dataset_id == dataset_id).all()

    if not rules:
        return {"status": "no_rules", "message": "No validation rules defined"}

    df = pd.read_csv(dataset.file_path)

    results = []
    overall_status = "PASSED"

    for rule in rules:
        col = rule.column_name

        if col not in df.columns:
            results.append({
                "rule_id": rule.id,
                "column": col,
                "rule_type": rule.rule_type,
                "parameters": rule.parameters,
                "status": "ERROR",
                "message": f"Column '{col}' not found in dataset",
                "violations": 0,
                "violation_details": []
            })
            overall_status = "FAILED"
            continue

        mask = pd.Series([False] * len(df))

        if rule.rule_type == "not_null":
            mask = df[col].isnull()

        elif rule.rule_type == "unique":
            mask = df[col].duplicated(keep=False)

        elif rule.rule_type == "range":
            params = rule.parameters
            min_val = params.get("min")
            max_val = params.get("max")

            if df[col].dtype in ['int64', 'float64', 'int32', 'float32']:
                if min_val is not None:
                    mask = mask | (df[col] < min_val)
                if max_val is not None:
                    mask = mask | (df[col] > max_val)
            else:
                results.append({
                    "rule_id": rule.id,
                    "column": col,
                    "rule_type": rule.rule_type,
                    "parameters": rule.parameters,
                    "status": "SKIPPED",
                    "message": f"Column '{col}' is not numeric (type: {df[col].dtype}). Range rule skipped.",
                    "violations": 0,
                    "violation_details": []
                })
                continue

        elif rule.rule_type == "regex":
            pattern = rule.parameters.get("pattern")
            if pattern:
                mask = ~df[col].astype(str).str.match(pattern, na=False)

        violations = mask.sum()

        # Формируем детальную информацию о нарушениях
        violation_details = []
        if violations > 0:
            violated_rows = df[mask].head(50)
            for idx, row in violated_rows.iterrows():
                violation_details.append({
                    "row_index": int(idx),
                    "column_value": str(row[col])[:100],
                    "row_data": {k: str(v)[:50] for k, v in row.to_dict().items()}
                })

        status = "FAILED" if violations > 0 else "PASSED"
        if status == "FAILED":
            overall_status = "FAILED"

        results.append({
            "rule_id": rule.id,
            "column": col,
            "rule_type": rule.rule_type,
            "parameters": rule.parameters,
            "status": status,
            "message": f"Found {violations} violations" if violations > 0 else "All values valid",
            "violations": int(violations),
            "violation_details": violation_details
        })

    return {
        "overall_status": overall_status,
        "total_rules": len(rules),
        "passed": sum(1 for r in results if r["status"] == "PASSED"),
        "failed": sum(1 for r in results if r["status"] == "FAILED"),
        "results": results
    }


@app.delete("/datasets/{dataset_id}/rules/{rule_id}")
def delete_rule(dataset_id: int, rule_id: int, db: Session = Depends(get_db)):
    """Удалить правило валидации"""

    rule = db.query(models.ValidationRule).filter(
        models.ValidationRule.id == rule_id,
        models.ValidationRule.dataset_id == dataset_id
    ).first()

    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    db.delete(rule)
    db.commit()

    return {"message": f"Rule {rule_id} deleted successfully"}

@app.post("/datasets/{dataset_id}/new-version")
async def upload_new_version(
    dataset_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Загрузить новую версию существующего датасета"""

    # Находим оригинальный датасет
    original = db.query(models.Dataset)\
        .filter(models.Dataset.id == dataset_id).first()
    if not original:
        raise HTTPException(status_code=404, detail="Original dataset not found")

    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files allowed")

    # Читаем файл
    content = await file.read()
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large")

    # Определяем корневой датасет
    root_id = original.parent_id if original.parent_id else original.id

    # Находим максимальный номер версии для этого корня
    max_version = db.query(models.Dataset.version).filter(
        (models.Dataset.id == root_id) |
        (models.Dataset.parent_id == root_id)
    ).order_by(models.Dataset.version.desc()).first()

    new_version = (max_version[0] + 1) if max_version else 2

    # Генерируем имя для новой версии
    # Используем ОРИГИНАЛЬНОЕ имя файла, но добавляем версию
    original_name = file.filename.replace('.csv', '')
    new_filename = f"{original_name}_v{new_version}.csv"
    file_path = UPLOAD_DIR / new_filename

    with open(file_path, "wb") as f:
        f.write(content)

    import pandas as pd
    df = pd.read_csv(file_path)

    # Создаём запись новой версии
    new_dataset = models.Dataset(
        name=new_filename,
        version=new_version,
        file_path=str(file_path),
        total_rows=len(df),
        total_columns=len(df.columns),
        parent_id=root_id  # Важно! Указываем корень
    )
    db.add(new_dataset)
    db.commit()
    db.refresh(new_dataset)

    return {
        "message": f"Version {new_version} created",
        "root_id": root_id,
        "new_dataset": {
            "id": new_dataset.id,
            "name": new_dataset.name,
            "version": new_dataset.version,
            "total_rows": new_dataset.total_rows,
            "total_columns": new_dataset.total_columns
        }
    }


@app.get("/datasets/{dataset_id}/compare/{other_id}")
def compare_datasets(
    dataset_id: int,
    other_id: int,
    db: Session = Depends(get_db)
):
    """Сравнить два датасета"""

    ds1 = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    ds2 = db.query(models.Dataset).filter(models.Dataset.id == other_id).first()

    if not ds1 or not ds2:
        raise HTTPException(status_code=404, detail="Dataset not found")

    import pandas as pd
    df1 = pd.read_csv(ds1.file_path)
    df2 = pd.read_csv(ds2.file_path)

    comparison  = compare_versions(df1, df2)
    drift_score = calculate_drift_score(comparison)

    return {
        "dataset_a": {"id": ds1.id, "name": ds1.name, "version": ds1.version},
        "dataset_b": {"id": ds2.id, "name": ds2.name, "version": ds2.version},
        "drift_score": drift_score,
        "comparison": comparison
    }


@app.get("/datasets/{dataset_id}/versions")
def get_versions(dataset_id: int, db: Session = Depends(get_db)):
    """Получить все версии датасета"""

    # Находим текущий датасет
    dataset = db.query(models.Dataset)\
        .filter(models.Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Если у него есть parent — ищем все версии от корня
    root_id = dataset.parent_id if dataset.parent_id else dataset.id

    # Все версии с этим root_id (включая корень)
    all_versions = db.query(models.Dataset).filter(
        (models.Dataset.id == root_id) |
        (models.Dataset.parent_id == root_id)
    ).order_by(models.Dataset.version).all()

    return {
        "dataset_id": dataset_id,
        "root_id": root_id,
        "versions": [
            {
                "id": v.id,
                "name": v.name,
                "version": v.version,
                "upload_date": v.upload_date,
                "total_rows": v.total_rows,
                "total_columns": v.total_columns
            }
            for v in all_versions
        ]
    }

@app.post("/datasets/security-check")
@limiter.limit("20/minute")
async def security_check(request: Request, file: UploadFile = File(...)):
    """Проверить файл на безопасность без загрузки"""

    content = await file.read()

    return {
        "filename": sanitize_filename(file.filename),
        "size_mb": round(len(content) / 1024 / 1024, 3),
        "size_ok": validate_file_size(content),
        "extension_ok": validate_file_extension(file.filename),
        "structure": validate_csv_structure(content),
        "security_scan": scan_csv_content(content),
        "file_hash": compute_file_hash(content)
    }


@app.delete("/datasets/{dataset_id}")
def delete_dataset(dataset_id: int, db: Session = Depends(get_db)):
    """Удалить датасет и все связанные данные"""

    # Находим датасет
    dataset = db.query(models.Dataset) \
        .filter(models.Dataset.id == dataset_id).first()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Удаляем файл с диска
    import os
    if os.path.exists(dataset.file_path):
        try:
            os.remove(dataset.file_path)
        except Exception:
            pass  # Если файл не удалился — не критично

    # Удаляем связанные данные (каскадное удаление настроено в БД)
    # Profiles, Rules, Issues удалятся автоматически

    # Проверяем есть ли дочерние версии
    # Проверяем есть ли дочерние версии (только СУЩЕСТВУЮЩИЕ в БД)
    children = db.query(models.Dataset) \
        .filter(models.Dataset.parent_id == dataset_id) \
        .filter(models.Dataset.id != dataset_id) \
        .all()

    if children:
        child_names = ", ".join([c.name for c in children])
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete: {len(children)} version(s) depend on this dataset ({child_names}). Delete them first."
        )

    # Удаляем из БД
    db.delete(dataset)
    db.commit()

    return {
        "message": f"Dataset '{dataset.name}' deleted successfully",
        "deleted_id": dataset_id
    }
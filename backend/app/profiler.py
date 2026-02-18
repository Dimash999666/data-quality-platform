import pandas as pd
import numpy as np
from scipy import stats
from sklearn.ensemble import IsolationForest

def convert_to_native_types(obj):
    """Конвертирует numpy типы в нативные Python типы для JSON"""
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {key: convert_to_native_types(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_native_types(item) for item in obj]
    return obj


def profile_dataset(df: pd.DataFrame) -> dict:
    """Полный анализ качества датасета"""

    profile = {
        "total_rows": len(df),
        "total_columns": len(df.columns),
        "columns": list(df.columns),
        "missing_values": {},
        "missing_percentage": {},
        "duplicates": int(df.duplicated().sum()),
        "duplicates_percentage": round(df.duplicated().sum() / len(df) * 100, 2),
        "dtypes": {},
        "numeric_stats": {},
        "categorical_stats": {},
        "outliers": {}
    }

    # Типы данных
    for col in df.columns:
        profile["dtypes"][col] = str(df[col].dtype)

    # Пропущенные значения
    for col in df.columns:
        missing = int(df[col].isnull().sum())
        profile["missing_values"][col] = missing
        profile["missing_percentage"][col] = round(missing / len(df) * 100, 2)

    # Статистика для числовых колонок
    numeric_cols = df.select_dtypes(include='number').columns
    for col in numeric_cols:
        profile["numeric_stats"][col] = {
            "min": round(float(df[col].min()), 2) if not pd.isna(df[col].min()) else None,
            "max": round(float(df[col].max()), 2) if not pd.isna(df[col].max()) else None,
            "mean": round(float(df[col].mean()), 2) if not pd.isna(df[col].mean()) else None,
            "median": round(float(df[col].median()), 2) if not pd.isna(df[col].median()) else None,
            "std": round(float(df[col].std()), 2) if not pd.isna(df[col].std()) else None,
        }

        # Выбросы через Z-score
        clean = df[col].dropna()
        if len(clean) > 3:
            z_scores = np.abs(stats.zscore(clean))
            outlier_count = int((z_scores > 3).sum())
            profile["outliers"][col] = {
                "count": outlier_count,
                "percentage": round(outlier_count / len(df) * 100, 2)
            }

    # Статистика для текстовых колонок
    cat_cols = df.select_dtypes(include=['object']).columns
    for col in cat_cols:
        profile["categorical_stats"][col] = {
            "unique_count": int(df[col].nunique()),
            "top_values": df[col].value_counts().head(5).to_dict()
        }

    # Конвертируем numpy типы в Python типы
    profile = convert_to_native_types(profile)

    return profile


def detect_anomalies(df: pd.DataFrame) -> dict:
    """ML: Isolation Forest для поиска аномальных строк"""

    # Берём только числовые колонки
    numeric_df = df.select_dtypes(include='number')

    if numeric_df.empty or len(numeric_df.columns) < 1:
        return {
            "anomaly_count": 0,
            "anomaly_percentage": 0,
            "anomaly_indices": [],
            "message": "No numeric columns for anomaly detection"
        }

    if len(df) < 10:
        return {
            "anomaly_count": 0,
            "anomaly_percentage": 0,
            "anomaly_indices": [],
            "message": "Not enough rows for anomaly detection (need at least 10)"
        }

    # Заполняем пропуски медианой
    numeric_filled = numeric_df.fillna(numeric_df.median())

    # Isolation Forest
    iso_forest = IsolationForest(
        contamination=0.1,
        random_state=42
    )

    predictions = iso_forest.fit_predict(numeric_filled)
    anomaly_indices = list(np.where(predictions == -1)[0])

    result = {
        "anomaly_count": len(anomaly_indices),
        "anomaly_percentage": round(len(anomaly_indices) / len(df) * 100, 2),
        "anomaly_indices": anomaly_indices[:50],
        "message": f"Found {len(anomaly_indices)} anomalous rows"
    }

    # ← ДОБАВЬ ЭТУ СТРОКУ
    return convert_to_native_types(result)


def calculate_quality_score(profile: dict, anomalies: dict) -> float:
    """Считаем общий score качества от 0 до 100"""

    score = 100.0

    # Штраф за пропущенные значения
    missing_values = list(profile["missing_percentage"].values())
    avg_missing = float(np.mean(missing_values)) if missing_values else 0.0
    score -= avg_missing * 2

    # Штраф за дубликаты
    score -= float(profile["duplicates_percentage"]) * 1.5

    # Штраф за выбросы
    if profile["outliers"]:
        outlier_values = [v["percentage"] for v in profile["outliers"].values()]
        avg_outliers = float(np.mean(outlier_values)) if outlier_values else 0.0
        score -= avg_outliers * 1.5

    # Штраф за аномалии
    score -= float(anomalies["anomaly_percentage"]) * 1.0

    # Конвертируем в обычный Python float (не numpy!)
    return float(round(max(0.0, min(100.0, score)), 1))


def detect_issues(profile: dict, anomalies: dict) -> list:
    """Формируем список конкретных проблем"""

    issues = []

    # Проблемы с пропусками
    for col, pct in profile["missing_percentage"].items():
        if pct > 0:
            severity = "high" if pct > 20 else "medium" if pct > 5 else "low"
            issues.append({
                "issue_type": "missing_values",
                "severity": severity,
                "column_name": col,
                "description": f"Column '{col}' has {pct}% missing values ({profile['missing_values'][col]} rows)",
                "affected_rows": profile["missing_values"][col]
            })

    # Дубликаты
    if profile["duplicates"] > 0:
        severity = "high" if profile["duplicates_percentage"] > 10 else "medium"
        issues.append({
            "issue_type": "duplicates",
            "severity": severity,
            "column_name": None,
            "description": f"Found {profile['duplicates']} duplicate rows ({profile['duplicates_percentage']}%)",
            "affected_rows": profile["duplicates"]
        })

    # Выбросы
    for col, outlier_info in profile["outliers"].items():
        if outlier_info["count"] > 0:
            severity = "high" if outlier_info["percentage"] > 5 else "medium" if outlier_info[
                                                                                     "percentage"] > 1 else "low"
            issues.append({
                "issue_type": "outliers",
                "severity": severity,
                "column_name": col,
                "description": f"Column '{col}' has {outlier_info['count']} outliers ({outlier_info['percentage']}%)",
                "affected_rows": outlier_info["count"]
            })

    # Аномалии от ML
    if anomalies["anomaly_count"] > 0:
        issues.append({
            "issue_type": "anomalies",
            "severity": "medium",
            "column_name": None,
            "description": f"ML detected {anomalies['anomaly_count']} anomalous rows ({anomalies['anomaly_percentage']}%)",
            "affected_rows": anomalies["anomaly_count"]
        })

    # Конвертируем numpy типы в Python типы
    issues = convert_to_native_types(issues)

    return issues
import pandas as pd
import numpy as np
from typing import Optional


def compare_versions(df_old: pd.DataFrame, df_new: pd.DataFrame) -> dict:
    """Сравниваем два датасета и находим изменения"""

    result = {
        "row_changes": {},
        "column_changes": {},
        "quality_drift": {},
        "summary": []
    }

    # ── Изменения строк ───────────────────────────────────────────────────────
    old_rows = len(df_old)
    new_rows = len(df_new)
    row_diff = new_rows - old_rows

    result["row_changes"] = {
        "old": old_rows,
        "new": new_rows,
        "diff": row_diff,
        "diff_pct": round(row_diff / old_rows * 100, 2) if old_rows > 0 else 0
    }

    if row_diff > 0:
        result["summary"].append(f"✓ Added {row_diff} rows (+{round(row_diff/old_rows*100,1)}%)")
    elif row_diff < 0:
        result["summary"].append(f"⚠ Removed {abs(row_diff)} rows ({round(row_diff/old_rows*100,1)}%)")
    else:
        result["summary"].append("→ Row count unchanged")

    # ── Изменения колонок ─────────────────────────────────────────────────────
    old_cols = set(df_old.columns)
    new_cols = set(df_new.columns)

    added_cols   = list(new_cols - old_cols)
    removed_cols = list(old_cols - new_cols)
    common_cols  = list(old_cols & new_cols)

    result["column_changes"] = {
        "added":   added_cols,
        "removed": removed_cols,
        "common":  common_cols
    }

    if added_cols:
        result["summary"].append(f"✓ New columns: {', '.join(added_cols)}")
    if removed_cols:
        result["summary"].append(f"⚠ Removed columns: {', '.join(removed_cols)}")

    # ── Дрейф качества по общим колонкам ─────────────────────────────────────
    for col in common_cols:
        drift = {}

        # Изменение пропусков
        old_missing = round(df_old[col].isnull().sum() / len(df_old) * 100, 2)
        new_missing = round(df_new[col].isnull().sum() / len(df_new) * 100, 2)
        missing_diff = round(new_missing - old_missing, 2)

        drift["missing_old"] = old_missing
        drift["missing_new"] = new_missing
        drift["missing_diff"] = missing_diff
        drift["missing_status"] = (
            "improved" if missing_diff < -2 else
            "degraded" if missing_diff > 2  else
            "stable"
        )

        # Изменение дубликатов
        old_dups = round(df_old[col].duplicated().sum() / len(df_old) * 100, 2)
        new_dups = round(df_new[col].duplicated().sum() / len(df_new) * 100, 2)
        drift["duplicates_diff"] = round(new_dups - old_dups, 2)

        # Статистика для числовых колонок
        if df_old[col].dtype in ['int64', 'float64'] and df_new[col].dtype in ['int64', 'float64']:
            old_mean = df_old[col].mean()
            new_mean = df_new[col].mean()

            if not pd.isna(old_mean) and not pd.isna(new_mean) and old_mean != 0:
                mean_change = round((new_mean - old_mean) / abs(old_mean) * 100, 2)
                drift["mean_old"]    = round(float(old_mean), 2)
                drift["mean_new"]    = round(float(new_mean), 2)
                drift["mean_change_pct"] = mean_change
                drift["mean_status"] = (
                    "significant_change" if abs(mean_change) > 20 else
                    "moderate_change"    if abs(mean_change) > 5  else
                    "stable"
                )

                if abs(mean_change) > 20:
                    result["summary"].append(
                        f"⚠ Column '{col}' mean changed significantly: "
                        f"{round(float(old_mean),1)} → {round(float(new_mean),1)} ({mean_change:+.1f}%)"
                    )

        # Сохраняем только если есть изменения
        if abs(missing_diff) > 0 or drift.get("mean_change_pct", 0) != 0:
            result["quality_drift"][col] = drift

        # Предупреждение если пропуски выросли
        if missing_diff > 5:
            result["summary"].append(
                f"⚠ Column '{col}' missing values increased: "
                f"{old_missing}% → {new_missing}%"
            )
        elif missing_diff < -5:
            result["summary"].append(
                f"✓ Column '{col}' missing values decreased: "
                f"{old_missing}% → {new_missing}%"
            )

    # Если нет изменений
    if not result["quality_drift"]:
        result["summary"].append("→ No significant quality drift detected")

    return result


def calculate_drift_score(comparison: dict) -> dict:
    """Общая оценка дрейфа данных"""

    issues = 0
    improvements = 0

    for col, drift in comparison["quality_drift"].items():
        if drift.get("missing_status") == "degraded":
            issues += 1
        elif drift.get("missing_status") == "improved":
            improvements += 1

        if drift.get("mean_status") == "significant_change":
            issues += 1

    if comparison["column_changes"]["removed"]:
        issues += len(comparison["column_changes"]["removed"])

    row_diff_pct = abs(comparison["row_changes"].get("diff_pct", 0))
    if row_diff_pct > 30:
        issues += 1

    overall = (
        "critical"  if issues >= 3 else
        "warning"   if issues >= 1 else
        "good"
    )

    return {
        "overall": overall,
        "issues_count": issues,
        "improvements_count": improvements,
        "label": {
            "critical": "🔴 Significant degradation",
            "warning":  "🟡 Minor changes detected",
            "good":     "🟢 Data quality stable"
        }[overall]
    }
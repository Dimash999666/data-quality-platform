import os
import json
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

def get_client():
    """Создаём клиент только когда нужен"""
    return Groq(api_key=os.getenv("GROQ_API_KEY"))


def analyze_quality(profile: dict, issues: list, quality_score: float) -> dict:
    """AI агент анализирует качество датасета и даёт рекомендации"""

    prompt = f"""
You are a Data Quality Expert. Analyze this dataset quality report and provide actionable recommendations.

QUALITY SCORE: {quality_score}/100

DATASET OVERVIEW:
- Total rows: {profile['total_rows']}
- Total columns: {profile['total_columns']}
- Columns: {', '.join(profile['columns'])}
- Duplicate rows: {profile['duplicates']} ({profile['duplicates_percentage']}%)

MISSING VALUES:
{json.dumps(profile['missing_percentage'], indent=2)}

NUMERIC STATISTICS:
{json.dumps(profile['numeric_stats'], indent=2)}

DETECTED ISSUES:
{json.dumps(issues, indent=2)}

Please provide your analysis in this EXACT JSON format (no markdown, just JSON):
{{
    "summary": "2-3 sentence overview of data quality",
    "critical_problems": [
        "problem 1",
        "problem 2"
    ],
    "recommendations": [
        "specific action 1",
        "specific action 2",
        "specific action 3"
    ],
    "ml_readiness": "assessment of whether this data is ready for ML models",
    "ml_risks": [
        "risk 1",
        "risk 2"
    ],
    "suggested_rules": [
        {{"column": "column_name", "rule": "rule_type", "reason": "why"}}
    ]
}}
"""

    response = get_client().chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {
                "role": "system",
                "content": "You are a data quality expert. Always respond with valid JSON only, no markdown, no extra text."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0.3,
        max_tokens=1024
    )

    raw = response.choices[0].message.content.strip()

    # Убираем markdown если модель всё же добавила
    if "```json" in raw:
        raw = raw.split("```json")[1].split("```")[0].strip()
    elif "```" in raw:
        raw = raw.split("```")[1].split("```")[0].strip()

    return json.loads(raw)


def suggest_rules(column_name: str, sample_values: list, dtype: str, stats: dict = None) -> dict:
    """AI предлагает validation rules для конкретной колонки"""

    prompt = f"""
You are a data validation expert.

Analyze this column and suggest validation rules:
- Column name: {column_name}
- Data type: {dtype}
- Sample values: {sample_values}
- Statistics: {json.dumps(stats) if stats else 'N/A'}

Respond ONLY with valid JSON (no markdown):
{{
    "rules": [
        {{
            "type": "not_null",
            "reason": "why this rule is needed"
        }},
        {{
            "type": "range",
            "min": 0,
            "max": 100,
            "reason": "why this range makes sense"
        }}
    ],
    "explanation": "brief explanation of the column's expected data"
}}

Possible rule types: not_null, unique, range, regex, min_length, max_length
"""

    response = get_client().chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {
                "role": "system",
                "content": "You are a data validation expert. Always respond with valid JSON only."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0.2,
        max_tokens=512
    )

    raw = response.choices[0].message.content.strip()

    if "```json" in raw:
        raw = raw.split("```json")[1].split("```")[0].strip()
    elif "```" in raw:
        raw = raw.split("```")[1].split("```")[0].strip()

    return json.loads(raw)


def explain_issue(issue_type: str, column: str, description: str) -> str:
    """AI объясняет конкретную проблему простым языком"""

    prompt = f"""
Explain this data quality issue in simple, non-technical language (2-3 sentences):

Issue type: {issue_type}
Column: {column}
Description: {description}

Then suggest one quick fix.
Keep it under 100 words total.
"""

    response = get_client().chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "user", "content": prompt}
        ],
        temperature=0.4,
        max_tokens=200
    )

    return response.choices[0].message.content.strip()
import re
import os
import hashlib
from pathlib import Path

# ── Разрешённые MIME типы ─────────────────────────────────────────────────────
ALLOWED_EXTENSIONS = {".csv"}
MAX_FILE_SIZE_MB = 100
MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024

# ── Опасные паттерны в CSV (инъекции) ────────────────────────────────────────
DANGEROUS_PATTERNS = [
    r"^=",  # Excel formula injection
    r"^\+",
    r"^-",
    r"^@",
    r"<script",  # XSS в случае рендера
    r"javascript:",
]


def validate_file_extension(filename: str) -> bool:
    """Проверяем расширение файла"""
    ext = Path(filename).suffix.lower()
    return ext in ALLOWED_EXTENSIONS


def validate_file_size(content: bytes) -> bool:
    """Проверяем размер файла"""
    return len(content) <= MAX_FILE_SIZE


def sanitize_filename(filename: str) -> str:
    """Очищаем имя файла от опасных символов"""
    # Убираем path traversal
    filename = os.path.basename(filename)
    # Оставляем только безопасные символы
    filename = re.sub(r'[^\w\s\-_.]', '', filename)
    # Убираем двойные точки
    filename = filename.replace("..", "")
    # Ограничиваем длину
    name, ext = os.path.splitext(filename)
    return f"{name[:100]}{ext}"


def scan_csv_content(content: bytes) -> dict:
    """Сканируем содержимое CSV на опасные паттерны"""

    issues = []

    try:
        text = content.decode("utf-8", errors="replace")
        lines = text.split("\n")[:100]

        # Пропускаем заголовок
        for line_num, line in enumerate(lines[1:], 2):
            cells = line.split(",")
            for cell_num, cell in enumerate(cells, 1):
                cell = cell.strip().strip('"').strip("'")

                # Только реально опасные паттерны:
                # =CMD(...), =SUM(...) — Excel инъекции
                # +cmd|'/C calc' — command injection
                # @SUM(...) — формулы
                # javascript: — XSS
                # <script — XSS
                dangerous = (
                        re.match(r'^=\w+\(', cell) or  # =SUM( =CMD(
                        re.match(r'^\+cmd\|', cell) or  # +cmd|'/C calc'
                        re.match(r'^@\w+\(', cell) or  # @SUM(
                        re.match(r'(?i)^javascript:', cell) or  # javascript:
                        re.match(r'(?i)^<script', cell)  # <script
                )

                if dangerous:
                    issues.append({
                        "line": line_num,
                        "cell": cell_num,
                        "value": cell[:50]
                    })
    except Exception:
        pass

    return {
        "safe": len(issues) == 0,
        "issues": issues[:10],
        "message": "File is safe" if not issues else f"Found {len(issues)} suspicious patterns"
    }


def compute_file_hash(content: bytes) -> str:
    """SHA256 хеш файла для дедупликации"""
    return hashlib.sha256(content).hexdigest()


def validate_csv_structure(content: bytes) -> dict:
    """Базовая проверка структуры CSV"""

    try:
        text = content.decode("utf-8", errors="replace")
        lines = [l for l in text.split("\n") if l.strip()]

        if len(lines) < 2:
            return {"valid": False, "reason": "CSV must have at least a header and one data row"}

        # Проверяем заголовок
        header = lines[0].split(",")
        if len(header) < 1:
            return {"valid": False, "reason": "CSV must have at least one column"}

        if len(header) > 500:
            return {"valid": False, "reason": "Too many columns (max 500)"}

        if len(lines) > 1_000_000:
            return {"valid": False, "reason": "Too many rows (max 1,000,000)"}

        return {
            "valid": True,
            "columns": len(header),
            "rows": len(lines) - 1
        }

    except Exception as e:
        return {"valid": False, "reason": str(e)}
"""Google Sheets DB helpers for the academy student management app."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

import gspread
import pandas as pd
import streamlit as st
from google.oauth2.service_account import Credentials

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

SHEET_HEADERS: dict[str, list[str]] = {
    "Classes": ["반ID", "반이름", "담당쌤", "생성일"],
    "Students": [
        "학생ID",
        "반ID",
        "학생이름",
        "학년",
        "전화번호",
        "부모님연락처",
        "등록일",
        "상태",
    ],
    "Records": [
        "기록ID",
        "학생ID",
        "날짜",
        "테스트결과",
        "만점",
        "평균",
        "난이도",
        "학습진도",
        "과제안내",
        "과제이행률",
        "특이사항",
    ],
    "Attendance": ["출결ID", "학생ID", "반ID", "날짜", "출결상태", "비고"],
}

# Legacy column aliases → current Students headers
_STUDENT_COLUMN_ALIASES: dict[str, str] = {
    "연락처": "전화번호",
}

# Sheets that should be rewritten when headers drift (drop/rename columns)
_MIGRATE_SHEETS: set[str] = {"Students", "Records"}

GRADE_OPTIONS = [
    "초1",
    "초2",
    "초3",
    "초4",
    "초5",
    "초6",
    "중1",
    "중2",
    "중3",
    "고1",
    "고2",
    "고3",
    "기타",
]

STATUS_OPTIONS = ["재원", "퇴원"]


def _today_str() -> str:
    return date.today().isoformat()


def generate_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


@st.cache_resource(show_spinner="Google Sheets 연결 중...")
def get_client() -> gspread.Client:
    """Authenticate with the service account stored in st.secrets."""
    sa_info = dict(st.secrets["gcp_service_account"])
    # private_key may contain literal \n in TOML; normalize newlines
    if "private_key" in sa_info and isinstance(sa_info["private_key"], str):
        sa_info["private_key"] = sa_info["private_key"].replace("\\n", "\n")
    credentials = Credentials.from_service_account_info(sa_info, scopes=SCOPES)
    return gspread.authorize(credentials)


def get_spreadsheet() -> gspread.Spreadsheet:
    client = get_client()
    sheet_id = st.secrets["SHEET_ID"]
    return client.open_by_key(sheet_id)


def _rewrite_sheet_with_headers(
    ws: gspread.Worksheet,
    new_headers: list[str],
    alias_map: dict[str, str] | None = None,
) -> None:
    """Rewrite a worksheet to match new_headers, preserving row data via column names."""
    values = ws.get_all_values()
    alias_map = alias_map or {}
    if not values:
        ws.append_row(new_headers, value_input_option="USER_ENTERED")
        return

    old_headers = values[0]
    if old_headers == new_headers:
        return

    # Only header, empty cells → just set headers
    if len(values) == 1 and all(not c.strip() for c in old_headers):
        ws.clear()
        ws.append_row(new_headers, value_input_option="USER_ENTERED")
        return

    # Map each old column to a canonical name
    col_index: dict[str, int] = {}
    for idx, name in enumerate(old_headers):
        canonical = alias_map.get(name, name)
        if canonical and canonical not in col_index:
            col_index[canonical] = idx

    new_rows: list[list[str]] = [new_headers]
    for row in values[1:]:
        if not any(str(c).strip() for c in row):
            continue
        new_row = []
        for col in new_headers:
            idx = col_index.get(col)
            if idx is None or idx >= len(row):
                new_row.append("")
            else:
                new_row.append(row[idx])
        new_rows.append(new_row)

    ws.clear()
    ws.update(new_rows, range_name="A1", value_input_option="USER_ENTERED")


def ensure_sheets() -> None:
    """Create missing worksheets and ensure header rows exist (migrates schema)."""
    ss = get_spreadsheet()
    existing = {ws.title for ws in ss.worksheets()}
    for name, headers in SHEET_HEADERS.items():
        if name not in existing:
            ws = ss.add_worksheet(title=name, rows=1000, cols=len(headers))
            ws.append_row(headers, value_input_option="USER_ENTERED")
            continue

        ws = ss.worksheet(name)
        values = ws.get_all_values()
        if not values:
            ws.append_row(headers, value_input_option="USER_ENTERED")
            continue

        if values[0] == headers:
            continue

        if name in _MIGRATE_SHEETS:
            aliases = _STUDENT_COLUMN_ALIASES if name == "Students" else None
            _rewrite_sheet_with_headers(ws, headers, aliases)
            clear_data_cache()
        elif len(values) == 1 and all(not c.strip() for c in values[0]):
            ws.update([headers], range_name="A1", value_input_option="USER_ENTERED")


def get_worksheet(name: str) -> gspread.Worksheet:
    ensure_sheets()
    return get_spreadsheet().worksheet(name)


@st.cache_data(ttl=30, show_spinner=False)
def load_sheet(name: str) -> pd.DataFrame:
    """Load a worksheet into a DataFrame. Cached briefly to reduce API calls."""
    ws = get_worksheet(name)
    records = ws.get_all_records()
    headers = SHEET_HEADERS[name]
    if not records:
        return pd.DataFrame(columns=headers)
    df = pd.DataFrame(records)

    # Soft-migrate legacy Students columns in-memory if sheet rewrite hasn't run yet
    if name == "Students":
        for old, new in _STUDENT_COLUMN_ALIASES.items():
            if old in df.columns and new not in df.columns:
                df[new] = df[old]
            elif old in df.columns and new in df.columns:
                empty_new = df[new].astype(str).str.strip().isin(["", "nan", "None"])
                df.loc[empty_new, new] = df.loc[empty_new, old]

    for col in headers:
        if col not in df.columns:
            df[col] = ""
    return df[headers].copy()

def clear_data_cache() -> None:
    load_sheet.clear()


def append_row(sheet_name: str, row: list[Any]) -> None:
    ws = get_worksheet(sheet_name)
    ws.append_row(row, value_input_option="USER_ENTERED")
    clear_data_cache()


def delete_rows_by_ids(sheet_name: str, id_column: str, ids: list[str]) -> int:
    """Delete rows whose id_column value is in ids. Returns number of deleted rows."""
    if not ids:
        return 0
    ws = get_worksheet(sheet_name)
    values = ws.get_all_values()
    if len(values) <= 1:
        return 0
    headers = values[0]
    if id_column not in headers:
        raise ValueError(f"Column {id_column} not found in {sheet_name}")
    col_idx = headers.index(id_column)
    id_set = set(ids)
    # Delete from bottom to top so indices stay valid
    deleted = 0
    for row_num in range(len(values), 1, -1):
        row = values[row_num - 1]
        if col_idx < len(row) and row[col_idx] in id_set:
            ws.delete_rows(row_num)
            deleted += 1
    clear_data_cache()
    return deleted


def update_cells_by_id(
    sheet_name: str,
    id_column: str,
    row_id: str,
    updates: dict[str, Any],
) -> bool:
    """Update columns for a single row matched by id. Returns True if found."""
    ws = get_worksheet(sheet_name)
    values = ws.get_all_values()
    if len(values) <= 1:
        return False
    headers = values[0]
    if id_column not in headers:
        raise ValueError(f"Column {id_column} not found in {sheet_name}")
    id_idx = headers.index(id_column)
    for row_num, row in enumerate(values[1:], start=2):
        if id_idx < len(row) and row[id_idx] == row_id:
            for col_name, new_val in updates.items():
                if col_name not in headers:
                    continue
                col_letter_idx = headers.index(col_name) + 1
                ws.update_cell(row_num, col_letter_idx, new_val)
            clear_data_cache()
            return True
    return False


def find_row_indices(
    sheet_name: str,
    filters: dict[str, str],
) -> list[int]:
    """Return 1-based sheet row numbers (including header offset) matching filters."""
    ws = get_worksheet(sheet_name)
    values = ws.get_all_values()
    if len(values) <= 1:
        return []
    headers = values[0]
    matches: list[int] = []
    for row_num, row in enumerate(values[1:], start=2):
        ok = True
        for col, expected in filters.items():
            if col not in headers:
                ok = False
                break
            idx = headers.index(col)
            cell = row[idx] if idx < len(row) else ""
            if str(cell) != str(expected):
                ok = False
                break
        if ok:
            matches.append(row_num)
    return matches


def delete_row_numbers(sheet_name: str, row_numbers: list[int]) -> int:
    """Delete specific 1-based row numbers (descending order)."""
    if not row_numbers:
        return 0
    ws = get_worksheet(sheet_name)
    deleted = 0
    for row_num in sorted(row_numbers, reverse=True):
        ws.delete_rows(row_num)
        deleted += 1
    clear_data_cache()
    return deleted


# ---------- Domain helpers ----------


def list_classes() -> pd.DataFrame:
    return load_sheet("Classes")


def add_class(name: str, teacher: str) -> str:
    class_id = generate_id("CLS")
    append_row("Classes", [class_id, name.strip(), teacher.strip(), _today_str()])
    return class_id


def get_class(class_id: str) -> dict[str, Any] | None:
    classes = load_sheet("Classes")
    match = classes[classes["반ID"].astype(str) == str(class_id)]
    if match.empty:
        return None
    return match.iloc[0].to_dict()


def update_class(class_id: str, updates: dict[str, Any]) -> bool:
    """Update class fields. Allowed: 반이름, 담당쌤."""
    allowed = {"반이름", "담당쌤"}
    cleaned = {k: v for k, v in updates.items() if k in allowed}
    if not cleaned:
        return False
    return update_cells_by_id("Classes", "반ID", class_id, cleaned)


def delete_class(class_id: str, cascade_students: bool = False) -> None:
    students = load_sheet("Students")
    class_students = students[students["반ID"] == class_id]
    student_ids = class_students["학생ID"].astype(str).tolist()
    if cascade_students and student_ids:
        # Remove related attendance & records
        delete_rows_by_ids("Attendance", "학생ID", student_ids)
        delete_rows_by_ids("Records", "학생ID", student_ids)
        delete_rows_by_ids("Students", "학생ID", student_ids)
    delete_rows_by_ids("Classes", "반ID", [class_id])


def list_students(class_id: str | None = None, active_only: bool = True) -> pd.DataFrame:
    df = load_sheet("Students")
    if class_id:
        df = df[df["반ID"] == class_id]
    if active_only and "상태" in df.columns:
        df = df[df["상태"].astype(str).isin(["재원", ""])]
    return df.reset_index(drop=True)


def add_student(
    class_id: str,
    name: str,
    grade: str = "",
    phone: str = "",
    parent_phone: str = "",
    status: str = "재원",
) -> str:
    student_id = generate_id("STU")
    append_row(
        "Students",
        [
            student_id,
            class_id,
            name.strip(),
            grade.strip(),
            phone.strip(),
            parent_phone.strip(),
            _today_str(),
            status.strip() or "재원",
        ],
    )
    return student_id


def update_student(student_id: str, updates: dict[str, Any]) -> bool:
    """Update student profile fields. Allowed keys match Students columns (except 학생ID)."""
    allowed = {
        "반ID",
        "학생이름",
        "학년",
        "전화번호",
        "부모님연락처",
        "등록일",
        "상태",
    }
    cleaned = {k: v for k, v in updates.items() if k in allowed}
    if not cleaned:
        return False
    return update_cells_by_id("Students", "학생ID", student_id, cleaned)


def get_student(student_id: str) -> dict[str, Any] | None:
    students = load_sheet("Students")
    match = students[students["학생ID"].astype(str) == str(student_id)]
    if match.empty:
        return None
    return match.iloc[0].to_dict()


def delete_student(student_id: str, cascade: bool = True) -> None:
    if cascade:
        delete_rows_by_ids("Attendance", "학생ID", [student_id])
        delete_rows_by_ids("Records", "학생ID", [student_id])
    delete_rows_by_ids("Students", "학생ID", [student_id])


def move_student(student_id: str, new_class_id: str) -> bool:
    return update_student(student_id, {"반ID": new_class_id})


def _score_ratios_for_student(
    student_id: str,
    *,
    exclude_record_ids: set[str] | None = None,
) -> list[float]:
    records = load_sheet("Records")
    student_records = records[records["학생ID"].astype(str) == str(student_id)]
    exclude_record_ids = exclude_record_ids or set()
    ratios: list[float] = []
    for _, r in student_records.iterrows():
        if str(r.get("기록ID", "")) in exclude_record_ids:
            continue
        ratio = parse_score_ratio(r["테스트결과"], r["만점"])
        if ratio is not None:
            ratios.append(ratio)
    return ratios


def _rolling_average(ratios: list[float], current_ratio: float) -> float:
    recent = (ratios + [current_ratio])[-10:]
    return round(sum(recent) / len(recent), 1) if recent else current_ratio


def find_records_for_date(student_id: str, record_date: str) -> pd.DataFrame:
    records = get_student_records(student_id)
    if records.empty:
        return records
    return records[records["날짜"].astype(str) == str(record_date)].reset_index(drop=True)


def records_exist_for_class_date(class_id: str, record_date: str) -> list[str]:
    """Return student IDs in the class that already have a record on record_date."""
    students = list_students(class_id, active_only=True)
    if students.empty:
        return []
    records = load_sheet("Records")
    if records.empty:
        return []
    sid_set = set(students["학생ID"].astype(str))
    matched = records[
        (records["학생ID"].astype(str).isin(sid_set))
        & (records["날짜"].astype(str) == str(record_date))
    ]
    return matched["학생ID"].astype(str).tolist()


def add_record(
    student_id: str,
    record_date: str,
    score: int | float,
    max_score: int | float,
    difficulty: str,
    progress: str,
    homework: str,
    homework_rate: str,
    notes: str = "",
    *,
    overwrite: bool = False,
) -> tuple[str, float]:
    """Append a record (optionally overwriting same student+date). Returns (record_id, avg)."""
    existing = find_records_for_date(student_id, record_date)
    if not existing.empty and not overwrite:
        raise ValueError("EXISTING")
    exclude_ids: set[str] = set()
    if not existing.empty and overwrite:
        exclude_ids = set(existing["기록ID"].astype(str))
        delete_rows_by_ids("Records", "기록ID", list(exclude_ids))

    try:
        current_ratio = (
            float(score) / float(max_score) * 100 if float(max_score) > 0 else 0.0
        )
    except (TypeError, ValueError):
        current_ratio = 0.0
    ratios = _score_ratios_for_student(student_id, exclude_record_ids=exclude_ids)
    avg = _rolling_average(ratios, current_ratio)

    record_id = generate_id("REC")
    append_row(
        "Records",
        [
            record_id,
            student_id,
            record_date,
            score,
            max_score,
            avg,
            difficulty,
            progress,
            homework,
            homework_rate,
            notes,
        ],
    )
    return record_id, avg


def update_record(record_id: str, updates: dict[str, Any]) -> bool:
    """Update an existing record. Recalculates 평균 if score fields change."""
    records = load_sheet("Records")
    match = records[records["기록ID"].astype(str) == str(record_id)]
    if match.empty:
        return False
    row = match.iloc[0]
    student_id = str(row["학생ID"])

    allowed = {
        "날짜",
        "테스트결과",
        "만점",
        "난이도",
        "학습진도",
        "과제안내",
        "과제이행률",
        "특이사항",
    }
    cleaned = {k: v for k, v in updates.items() if k in allowed}
    if not cleaned:
        return False

    score = cleaned.get("테스트결과", row["테스트결과"])
    max_score = cleaned.get("만점", row["만점"])
    try:
        current_ratio = (
            float(score) / float(max_score) * 100 if float(max_score) > 0 else 0.0
        )
    except (TypeError, ValueError):
        current_ratio = 0.0
    ratios = _score_ratios_for_student(
        student_id, exclude_record_ids={str(record_id)}
    )
    cleaned["평균"] = _rolling_average(ratios, current_ratio)
    return update_cells_by_id("Records", "기록ID", record_id, cleaned)


def delete_record(record_id: str) -> int:
    return delete_rows_by_ids("Records", "기록ID", [record_id])


def save_records_batch(
    record_date: str,
    common: dict[str, str],
    entries: list[dict[str, Any]],
    *,
    overwrite: bool = False,
) -> int:
    """
    Save multiple student records sharing common lesson fields.
    entries: [{학생ID, 테스트결과, 만점, 특이사항?, 난이도?, 학습진도?, 과제안내?, 과제이행률?}, ...]
    Per-entry optional fields override common.
    """
    saved = 0
    for e in entries:
        sid = str(e["학생ID"])
        notes = str(e.get("특이사항", common.get("특이사항", "")) or "")
        add_record(
            student_id=sid,
            record_date=record_date,
            score=e["테스트결과"],
            max_score=e["만점"],
            difficulty=str(e.get("난이도") or common["난이도"]),
            progress=str(e.get("학습진도") if e.get("학습진도") is not None else common["학습진도"]),
            homework=str(e.get("과제안내") if e.get("과제안내") is not None else common["과제안내"]),
            homework_rate=str(e.get("과제이행률") or common["과제이행률"]),
            notes=notes,
            overwrite=overwrite,
        )
        saved += 1
    return saved


def get_student_records(student_id: str) -> pd.DataFrame:
    df = load_sheet("Records")
    df = df[df["학생ID"] == student_id].copy()
    if df.empty:
        return df
    df["_date"] = pd.to_datetime(df["날짜"], errors="coerce")
    return df.sort_values("_date", ascending=False).drop(columns=["_date"]).reset_index(drop=True)


def get_class_records(class_id: str) -> pd.DataFrame:
    students = list_students(class_id, active_only=False)
    if students.empty:
        return pd.DataFrame(columns=SHEET_HEADERS["Records"])
    student_ids = set(students["학생ID"].astype(str))
    records = load_sheet("Records")
    return records[records["학생ID"].astype(str).isin(student_ids)].reset_index(drop=True)


def save_attendance_batch(
    class_id: str,
    attendance_date: str,
    entries: list[dict[str, str]],
    overwrite: bool = False,
) -> int:
    """
    Save attendance for a class on a date.
    entries: [{학생ID, 출결상태, 비고}, ...]
    If existing rows exist for class+date and overwrite=False, raises ValueError.
    """
    existing_rows = find_row_indices(
        "Attendance",
        {"반ID": class_id, "날짜": attendance_date},
    )
    if existing_rows and not overwrite:
        raise ValueError("EXISTING")
    if existing_rows and overwrite:
        delete_row_numbers("Attendance", existing_rows)

    rows = []
    for e in entries:
        rows.append(
            [
                generate_id("ATT"),
                e["학생ID"],
                class_id,
                attendance_date,
                e["출결상태"],
                e.get("비고", ""),
            ]
        )
    ws = get_worksheet("Attendance")
    if rows:
        ws.append_rows(rows, value_input_option="USER_ENTERED")
        clear_data_cache()
    return len(rows)


def get_attendance(
    class_id: str | None = None,
    student_id: str | None = None,
    attendance_date: str | None = None,
) -> pd.DataFrame:
    df = load_sheet("Attendance")
    if class_id:
        df = df[df["반ID"] == class_id]
    if student_id:
        df = df[df["학생ID"] == student_id]
    if attendance_date:
        df = df[df["날짜"] == attendance_date]
    return df.reset_index(drop=True)


def attendance_exists(class_id: str, attendance_date: str) -> bool:
    return bool(find_row_indices("Attendance", {"반ID": class_id, "날짜": attendance_date}))


def parse_score_ratio(score_val: Any, max_val: Any) -> float | None:
    try:
        s = float(score_val)
        m = float(max_val)
        if m <= 0:
            return None
        return s / m * 100
    except (TypeError, ValueError):
        return None


def class_name_map() -> dict[str, str]:
    classes = list_classes()
    if classes.empty:
        return {}
    return dict(zip(classes["반ID"].astype(str), classes["반이름"].astype(str)))


def student_name_map(class_id: str | None = None) -> dict[str, str]:
    students = list_students(class_id, active_only=False)
    if students.empty:
        return {}
    return dict(zip(students["학생ID"].astype(str), students["학생이름"].astype(str)))

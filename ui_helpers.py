"""Shared UI helpers — consistent 반/학생 selection across pages."""

from __future__ import annotations

import streamlit as st

import sheets_utils as db


def select_class(
    key: str = "selected_class_id",
    label: str = "반 선택",
    include_all: bool = False,
) -> str | None:
    """
    Render a class selectbox. Returns class_id or None.
    If include_all=True, first option is '전체' with value ''.
    """
    classes = db.list_classes()
    if classes.empty:
        st.info("등록된 반이 없습니다. 먼저 '반 관리'에서 반을 추가해 주세요.")
        return None

    options: list[tuple[str, str]] = []
    if include_all:
        options.append(("", "전체"))
    for _, row in classes.iterrows():
        options.append((str(row["반ID"]), f"{row['반이름']} ({row['담당쌤']})"))

    labels = [o[1] for o in options]
    ids = [o[0] for o in options]

    # Preserve previous selection when possible
    default_idx = 0
    prev = st.session_state.get(key)
    if prev in ids:
        default_idx = ids.index(prev)

    chosen_label = st.selectbox(label, labels, index=default_idx, key=f"{key}_widget")
    chosen_id = ids[labels.index(chosen_label)]
    st.session_state[key] = chosen_id if chosen_id else None
    return chosen_id if chosen_id else (None if not include_all else "")


def select_student(
    class_id: str | None,
    key: str = "selected_student_id",
    label: str = "학생 선택",
    active_only: bool = True,
) -> str | None:
    """Render a student selectbox filtered by class. Returns student_id or None."""
    if not class_id:
        st.caption("먼저 반을 선택해 주세요.")
        return None

    students = db.list_students(class_id, active_only=active_only)
    if students.empty:
        st.info("이 반에 등록된 학생이 없습니다.")
        return None

    options = [
        (str(row["학생ID"]), str(row["학생이름"]))
        for _, row in students.iterrows()
    ]
    labels = [o[1] for o in options]
    ids = [o[0] for o in options]

    default_idx = 0
    prev = st.session_state.get(key)
    if prev in ids:
        default_idx = ids.index(prev)

    chosen_label = st.selectbox(label, labels, index=default_idx, key=f"{key}_widget")
    chosen_id = ids[labels.index(chosen_label)]
    st.session_state[key] = chosen_id
    return chosen_id


def confirm_action(message: str, key: str) -> bool:
    """Checkbox confirmation for destructive actions."""
    return st.checkbox(message, key=key)

"""출결 체크 화면."""

from __future__ import annotations

from datetime import date

import streamlit as st

import sheets_utils as db
from ui_helpers import confirm_action, select_class


def render() -> None:
    st.header("출결 체크")

    class_id = select_class(key="att_class")
    if not class_id:
        return

    attendance_date = st.date_input("날짜", value=date.today(), key="att_date")
    date_str = attendance_date.isoformat()

    students = db.list_students(class_id, active_only=True)
    if students.empty:
        st.info("이 반에 재원 학생이 없습니다.")
        return

    already = db.attendance_exists(class_id, date_str)
    if already:
        st.warning(
            f"{date_str} 날짜에 이미 출결 기록이 있습니다. "
            "저장 시 기존 기록을 덮어쓰려면 아래 확인이 필요합니다."
        )

    # Bulk mark present
    col1, col2 = st.columns([1, 3])
    with col1:
        if st.button("전체 출석", use_container_width=True, key="att_all_present"):
            for _, row in students.iterrows():
                sid = str(row["학생ID"])
                st.session_state[f"att_status_{sid}"] = "출석"
            st.rerun()

    st.subheader("학생별 출결")
    entries: list[dict[str, str]] = []

    # Load existing if any for defaults
    existing_df = db.get_attendance(class_id=class_id, attendance_date=date_str)
    existing_map: dict[str, dict] = {}
    if not existing_df.empty:
        for _, r in existing_df.iterrows():
            existing_map[str(r["학생ID"])] = {
                "출결상태": str(r["출결상태"]),
                "비고": str(r.get("비고", "") or ""),
            }

    for _, row in students.iterrows():
        sid = str(row["학생ID"])
        sname = str(row["학생이름"])
        default_status = existing_map.get(sid, {}).get("출결상태", "출석")
        default_note = existing_map.get(sid, {}).get("비고", "")

        status_key = f"att_status_{sid}"
        note_key = f"att_note_{sid}"
        if status_key not in st.session_state:
            st.session_state[status_key] = default_status

        c1, c2, c3 = st.columns([2, 2, 3])
        with c1:
            st.markdown(f"**{sname}**")
        with c2:
            status = st.radio(
                "출결",
                ["출석", "결석"],
                horizontal=True,
                key=status_key,
                label_visibility="collapsed",
            )
        with c3:
            if note_key not in st.session_state:
                st.session_state[note_key] = default_note
            note = st.text_input(
                "비고",
                key=note_key,
                placeholder="사유 등 (선택)",
                label_visibility="collapsed",
            )
        entries.append({"학생ID": sid, "출결상태": status, "비고": note})

    st.divider()
    if st.session_state.pop("att_save_msg", None):
        st.success(st.session_state.pop("att_save_detail", "출결이 저장되었습니다."))

    overwrite = False
    if already:
        overwrite = confirm_action(
            f"{date_str} 기존 출결을 덮어쓰겠습니다.",
            key="att_overwrite_confirm",
        )

    can_save = (not already) or overwrite
    if st.button("저장", type="primary", disabled=not can_save, key="att_save"):
        try:
            count = db.save_attendance_batch(
                class_id,
                date_str,
                entries,
                overwrite=already and overwrite,
            )
            st.session_state["att_save_msg"] = True
            st.session_state["att_save_detail"] = (
                f"{date_str} 출결 {count}건이 저장되었습니다."
            )
            # Clear per-student status keys so next load uses fresh defaults
            for e in entries:
                sid = e["학생ID"]
                st.session_state.pop(f"att_status_{sid}", None)
                st.session_state.pop(f"att_note_{sid}", None)
            st.rerun()
        except ValueError as exc:
            if str(exc) == "EXISTING":
                st.error("이미 기록이 있습니다. 덮어쓰기 확인 후 다시 시도해 주세요.")
            else:
                st.error(str(exc))

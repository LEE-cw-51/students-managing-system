"""데이터 내보내기 화면."""

from __future__ import annotations

from datetime import datetime

import streamlit as st

import sheets_utils as db
from ui_helpers import select_class


def render() -> None:
    st.header("데이터 내보내기")
    st.caption("Records / Attendance를 CSV로 다운로드합니다.")

    scope = st.radio(
        "범위",
        ["반별", "전체"],
        horizontal=True,
        key="export_scope",
    )

    class_id: str | None = None
    class_label = "전체"
    if scope == "반별":
        class_id = select_class(key="export_class")
        if not class_id:
            return
        names = db.class_name_map()
        class_label = names.get(class_id, class_id)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    st.subheader("Records (일일 기록)")
    if class_id:
        records = db.get_class_records(class_id)
    else:
        records = db.load_sheet("Records")

    if records.empty:
        st.info("내보낼 Records가 없습니다.")
    else:
        # Enrich with student/class names for readability
        export_rec = records.copy()
        all_students = db.list_students(active_only=False)
        if not all_students.empty:
            name_map = dict(
                zip(
                    all_students["학생ID"].astype(str),
                    all_students["학생이름"].astype(str),
                )
            )
            class_of = dict(
                zip(
                    all_students["학생ID"].astype(str),
                    all_students["반ID"].astype(str),
                )
            )
            export_rec["학생이름"] = export_rec["학생ID"].astype(str).map(name_map)
            export_rec["반ID"] = export_rec["학생ID"].astype(str).map(class_of)
            cmap = db.class_name_map()
            export_rec["반이름"] = export_rec["반ID"].astype(str).map(cmap)
        st.dataframe(export_rec, use_container_width=True, hide_index=True)
        csv_bytes = export_rec.to_csv(index=False).encode("utf-8-sig")
        st.download_button(
            "Records CSV 다운로드",
            data=csv_bytes,
            file_name=f"records_{class_label}_{stamp}.csv",
            mime="text/csv",
            key="dl_records",
        )

    st.divider()
    st.subheader("Attendance (출결)")
    if class_id:
        attendance = db.get_attendance(class_id=class_id)
    else:
        attendance = db.load_sheet("Attendance")

    if attendance.empty:
        st.info("내보낼 Attendance가 없습니다.")
    else:
        export_att = attendance.copy()
        s_map = db.student_name_map()
        c_map = db.class_name_map()
        export_att["학생이름"] = export_att["학생ID"].astype(str).map(s_map)
        export_att["반이름"] = export_att["반ID"].astype(str).map(c_map)
        st.dataframe(export_att, use_container_width=True, hide_index=True)
        csv_bytes = export_att.to_csv(index=False).encode("utf-8-sig")
        st.download_button(
            "Attendance CSV 다운로드",
            data=csv_bytes,
            file_name=f"attendance_{class_label}_{stamp}.csv",
            mime="text/csv",
            key="dl_attendance",
        )

"""반 관리 화면."""

from __future__ import annotations

import streamlit as st

import sheets_utils as db
from ui_helpers import confirm_action


def render() -> None:
    st.header("반 관리")

    if st.session_state.pop("class_save_msg", None):
        st.success(st.session_state.pop("class_save_detail", "반이 추가되었습니다."))

    classes = db.list_classes()
    st.subheader("반 목록")
    if classes.empty:
        st.info("등록된 반이 없습니다.")
    else:
        students = db.list_students(active_only=False)
        display = classes.copy()
        counts = (
            students.groupby("반ID").size().rename("학생수")
            if not students.empty
            else None
        )
        if counts is not None:
            display = display.merge(
                counts, left_on="반ID", right_index=True, how="left"
            )
            display["학생수"] = display["학생수"].fillna(0).astype(int)
        else:
            display["학생수"] = 0
        st.dataframe(
            display[["반이름", "담당쌤", "생성일", "학생수"]],
            use_container_width=True,
            hide_index=True,
        )

    st.divider()
    st.subheader("반 추가")
    with st.form("add_class_form", clear_on_submit=True):
        name = st.text_input("반이름 *")
        teacher = st.text_input("담당쌤 *")
        submitted = st.form_submit_button("추가", type="primary")
    if submitted:
        if not name.strip() or not teacher.strip():
            st.error("반이름과 담당쌤을 모두 입력해 주세요.")
        else:
            db.add_class(name, teacher)
            st.session_state["class_save_msg"] = True
            st.session_state["class_save_detail"] = (
                f"반 '{name.strip()}'이(가) 추가되었습니다."
            )
            st.rerun()

    st.divider()
    st.subheader("반 삭제")
    if classes.empty:
        return

    options = {
        f"{row['반이름']} ({row['담당쌤']})": str(row["반ID"])
        for _, row in classes.iterrows()
    }
    chosen_label = st.selectbox("삭제할 반", list(options.keys()), key="del_class_sel")
    class_id = options[chosen_label]
    students_in_class = db.list_students(class_id, active_only=False)
    student_count = len(students_in_class)

    if student_count > 0:
        st.warning(
            f"이 반에 소속된 학생이 {student_count}명 있습니다. "
            "삭제하면 학생·출결·기록 데이터도 함께 삭제됩니다."
        )
        confirmed = confirm_action(
            f"학생 {student_count}명 포함, 반 삭제를 확인합니다.",
            key="del_class_confirm",
        )
    else:
        confirmed = confirm_action("이 반을 삭제합니다.", key="del_class_confirm")

    if st.button("반 삭제", type="primary", disabled=not confirmed, key="del_class_btn"):
        db.delete_class(class_id, cascade_students=True)
        st.success("반이 삭제되었습니다.")
        st.rerun()

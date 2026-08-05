"""학생 관리 화면."""

from __future__ import annotations

import streamlit as st

import sheets_utils as db
from ui_helpers import confirm_action, select_class


def render() -> None:
    st.header("학생 관리")

    if st.session_state.pop("stu_save_msg", None):
        st.success(st.session_state.pop("stu_save_detail", "학생이 추가되었습니다."))

    class_id = select_class(key="stu_mgmt_class")
    if not class_id:
        return

    students = db.list_students(class_id, active_only=False)
    st.subheader("학생 목록")
    if students.empty:
        st.info("이 반에 등록된 학생이 없습니다.")
    else:
        st.dataframe(
            students[["학생이름", "연락처", "등록일", "상태"]],
            use_container_width=True,
            hide_index=True,
        )

    st.divider()
    st.subheader("학생 추가")
    with st.form("add_student_form", clear_on_submit=True):
        name = st.text_input("학생이름 *")
        contact = st.text_input("연락처 (선택)")
        submitted = st.form_submit_button("학생 추가", type="primary")
    if submitted:
        if not name.strip():
            st.error("학생이름을 입력해 주세요.")
        else:
            db.add_student(class_id, name, contact)
            st.session_state["stu_save_msg"] = True
            st.session_state["stu_save_detail"] = (
                f"학생 '{name.strip()}'이(가) 추가되었습니다."
            )
            st.rerun()

    if students.empty:
        return

    st.divider()
    st.subheader("학생 삭제 / 반 이동")

    name_to_id = {
        f"{row['학생이름']} ({row['학생ID']})": str(row["학생ID"])
        for _, row in students.iterrows()
    }
    chosen = st.selectbox("대상 학생", list(name_to_id.keys()), key="stu_action_sel")
    student_id = name_to_id[chosen]
    student_name = chosen.split(" (")[0]

    tab_del, tab_move = st.tabs(["삭제", "다른 반으로 이동"])

    with tab_del:
        st.caption("삭제 시 해당 학생의 출결·기록 데이터도 함께 삭제됩니다.")
        confirmed = confirm_action(
            f"'{student_name}' 학생 삭제를 확인합니다.",
            key="stu_del_confirm",
        )
        if st.button("학생 삭제", type="primary", disabled=not confirmed, key="stu_del_btn"):
            db.delete_student(student_id, cascade=True)
            st.success(f"'{student_name}' 학생이 삭제되었습니다.")
            st.rerun()

    with tab_move:
        classes = db.list_classes()
        other = classes[classes["반ID"].astype(str) != class_id]
        if other.empty:
            st.info("이동할 다른 반이 없습니다.")
        else:
            move_options = {
                f"{row['반이름']} ({row['담당쌤']})": str(row["반ID"])
                for _, row in other.iterrows()
            }
            target_label = st.selectbox(
                "이동할 반", list(move_options.keys()), key="stu_move_target"
            )
            target_id = move_options[target_label]
            move_confirmed = confirm_action(
                f"'{student_name}' 학생을 '{target_label}'(으)로 이동합니다.",
                key="stu_move_confirm",
            )
            if st.button(
                "반 이동",
                type="primary",
                disabled=not move_confirmed,
                key="stu_move_btn",
            ):
                ok = db.move_student(student_id, target_id)
                if ok:
                    st.success(f"'{student_name}' 학생이 이동되었습니다.")
                    st.rerun()
                else:
                    st.error("이동에 실패했습니다. 학생을 찾을 수 없습니다.")

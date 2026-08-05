"""학생 관리 화면."""

from __future__ import annotations

import streamlit as st

import sheets_utils as db
from ui_helpers import confirm_action, select_class


def _grade_index(current: str) -> int:
    options = db.GRADE_OPTIONS
    if current in options:
        return options.index(current)
    return options.index("기타") if "기타" in options else 0


def _status_index(current: str) -> int:
    options = db.STATUS_OPTIONS
    if current in options:
        return options.index(current)
    return 0


def render() -> None:
    st.header("학생 관리")

    if st.session_state.pop("stu_save_msg", None):
        st.success(st.session_state.pop("stu_save_detail", "저장되었습니다."))

    class_id = select_class(key="stu_mgmt_class")
    if not class_id:
        return

    students = db.list_students(class_id, active_only=False)
    st.subheader("학생 목록")
    if students.empty:
        st.info("이 반에 등록된 학생이 없습니다.")
    else:
        display_cols = [
            "학생이름",
            "학년",
            "전화번호",
            "부모님연락처",
            "등록일",
            "상태",
        ]
        st.dataframe(
            students[display_cols],
            use_container_width=True,
            hide_index=True,
        )

    st.divider()
    st.subheader("학생 추가")
    with st.form("add_student_form", clear_on_submit=True):
        name = st.text_input("학생이름 *")
        grade = st.selectbox("학년", db.GRADE_OPTIONS, index=_grade_index("중1"))
        phone = st.text_input("전화번호 (선택)")
        parent_phone = st.text_input("부모님 연락처 (선택)")
        submitted = st.form_submit_button("학생 추가", type="primary")
    if submitted:
        if not name.strip():
            st.error("학생이름을 입력해 주세요.")
        else:
            db.add_student(
                class_id,
                name=name,
                grade=grade,
                phone=phone,
                parent_phone=parent_phone,
            )
            st.session_state["stu_save_msg"] = True
            st.session_state["stu_save_detail"] = (
                f"학생 '{name.strip()}'이(가) 추가되었습니다."
            )
            st.rerun()

    if students.empty:
        return

    st.divider()
    st.subheader("학생 수정 / 삭제 / 반 이동")

    name_to_id = {
        f"{row['학생이름']} ({row.get('학년', '') or '-'})": str(row["학생ID"])
        for _, row in students.iterrows()
    }
    # Keep unique labels if duplicate names
    if len(name_to_id) < len(students):
        name_to_id = {
            f"{row['학생이름']} / {row.get('학년', '') or '-'} ({row['학생ID'][-6:]})": str(
                row["학생ID"]
            )
            for _, row in students.iterrows()
        }

    chosen = st.selectbox("대상 학생", list(name_to_id.keys()), key="stu_action_sel")
    student_id = name_to_id[chosen]
    student = db.get_student(student_id)
    if not student:
        st.error("학생 정보를 불러오지 못했습니다.")
        return

    student_name = str(student.get("학생이름", ""))

    tab_edit, tab_del, tab_move = st.tabs(["정보 수정", "삭제", "다른 반으로 이동"])

    with tab_edit:
        form_nonce = st.session_state.get("stu_edit_nonce", 0)
        with st.form(f"edit_student_form_{form_nonce}"):
            edit_name = st.text_input("학생이름 *", value=student_name)
            edit_grade = st.selectbox(
                "학년",
                db.GRADE_OPTIONS,
                index=_grade_index(str(student.get("학년", "") or "")),
            )
            edit_phone = st.text_input(
                "전화번호",
                value=str(student.get("전화번호", "") or ""),
            )
            edit_parent = st.text_input(
                "부모님 연락처",
                value=str(student.get("부모님연락처", "") or ""),
            )
            edit_status = st.selectbox(
                "상태",
                db.STATUS_OPTIONS,
                index=_status_index(str(student.get("상태", "재원") or "재원")),
            )
            edit_submitted = st.form_submit_button("수정 저장", type="primary")

        if edit_submitted:
            if not edit_name.strip():
                st.error("학생이름을 입력해 주세요.")
            else:
                ok = db.update_student(
                    student_id,
                    {
                        "학생이름": edit_name.strip(),
                        "학년": edit_grade,
                        "전화번호": edit_phone.strip(),
                        "부모님연락처": edit_parent.strip(),
                        "상태": edit_status,
                    },
                )
                if ok:
                    st.session_state["stu_save_msg"] = True
                    st.session_state["stu_save_detail"] = (
                        f"'{edit_name.strip()}' 학생 정보가 수정되었습니다."
                    )
                    st.session_state["stu_edit_nonce"] = form_nonce + 1
                    st.rerun()
                else:
                    st.error("수정에 실패했습니다. 학생을 찾을 수 없습니다.")

    with tab_del:
        st.caption("삭제 시 해당 학생의 출결·기록 데이터도 함께 삭제됩니다.")
        confirmed = confirm_action(
            f"'{student_name}' 학생 삭제를 확인합니다.",
            key="stu_del_confirm",
        )
        if st.button("학생 삭제", type="primary", disabled=not confirmed, key="stu_del_btn"):
            db.delete_student(student_id, cascade=True)
            st.session_state["stu_save_msg"] = True
            st.session_state["stu_save_detail"] = (
                f"'{student_name}' 학생이 삭제되었습니다."
            )
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
                    st.session_state["stu_save_msg"] = True
                    st.session_state["stu_save_detail"] = (
                        f"'{student_name}' 학생이 이동되었습니다."
                    )
                    st.rerun()
                else:
                    st.error("이동에 실패했습니다. 학생을 찾을 수 없습니다.")

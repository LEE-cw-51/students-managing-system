"""일일 기록 입력 화면."""

from __future__ import annotations

from datetime import date

import streamlit as st

import sheets_utils as db
from templates import format_average_display, format_test_display
from ui_helpers import select_class, select_student

DIFFICULTY_OPTIONS = ["상", "중", "하"]
HOMEWORK_RATE_OPTIONS = ["A(100~90%)", "B(89~70%)", "C(70%미만)"]
FOCUS_OPTIONS = ["A(매우우수)", "B", "C"]


def render() -> None:
    st.header("일일 기록 입력")

    class_id = select_class(key="rec_class")
    if not class_id:
        return

    student_id = select_student(class_id, key="rec_student")
    if not student_id:
        return

    student_names = db.student_name_map(class_id)
    student_name = student_names.get(student_id, student_id)

    # Show recent average preview
    recent = db.get_student_records(student_id)
    if not recent.empty:
        with st.expander("최근 기록 (참고)", expanded=False):
            preview = recent.head(5).copy()
            preview["테스트"] = preview.apply(
                lambda r: format_test_display(r["테스트결과"], r["만점"]),
                axis=1,
            )
            st.dataframe(
                preview[["날짜", "테스트", "평균", "난이도", "과제이행률", "수업집중도"]],
                use_container_width=True,
                hide_index=True,
            )

    if st.session_state.pop("rec_save_msg", None):
        msg = st.session_state.pop("rec_save_detail", "")
        st.success(msg)
        avg_msg = st.session_state.pop("rec_save_avg", None)
        if avg_msg is not None:
            st.info(f"최근 최대 10회 기준 평균 점수: **{avg_msg}**")

    # Form key counter to reset form after successful submit
    form_nonce = st.session_state.get("rec_form_nonce", 0)

    with st.form(f"daily_record_form_{form_nonce}", clear_on_submit=True):
        record_date = st.date_input("날짜", value=date.today())
        c1, c2 = st.columns(2)
        with c1:
            score = st.number_input("테스트 맞은 개수", min_value=0, step=1, value=0)
        with c2:
            max_score = st.number_input("만점", min_value=1, step=1, value=10)
        difficulty = st.selectbox("난이도", DIFFICULTY_OPTIONS, index=1)
        progress = st.text_input("학습진도")
        homework = st.text_area("과제안내", height=100)
        homework_rate = st.selectbox("과제이행률", HOMEWORK_RATE_OPTIONS)
        focus = st.selectbox("수업집중도", FOCUS_OPTIONS)
        notes = st.text_input("특이사항 (선택)")
        submitted = st.form_submit_button("저장", type="primary")

    if submitted:
        if max_score <= 0:
            st.error("만점은 1 이상이어야 합니다.")
            return
        if score > max_score:
            st.error("맞은 개수는 만점을 초과할 수 없습니다.")
            return

        _record_id, avg = db.add_record(
            student_id=student_id,
            record_date=record_date.isoformat(),
            score=score,
            max_score=max_score,
            difficulty=difficulty,
            progress=progress.strip(),
            homework=homework.strip(),
            homework_rate=homework_rate,
            focus=focus,
            notes=notes.strip(),
        )
        st.session_state["rec_save_msg"] = True
        st.session_state["rec_save_detail"] = (
            f"{student_name} 학생 기록이 저장되었습니다. "
            f"(테스트 {format_test_display(score, max_score)}, "
            f"최근 평균 {format_average_display(avg)})"
        )
        st.session_state["rec_save_avg"] = format_average_display(avg)
        st.session_state["rec_form_nonce"] = form_nonce + 1
        st.rerun()

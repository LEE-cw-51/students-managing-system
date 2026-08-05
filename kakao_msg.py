"""카톡 문구 생성 화면."""

from __future__ import annotations

import streamlit as st

import sheets_utils as db
from templates import format_average_display, format_kakao_message, format_test_display
from ui_helpers import select_class, select_student


def render() -> None:
    st.header("카톡 문구 생성")
    st.caption("생성된 문구를 복사해 카카오톡에 붙여넣어 사용하세요. 자동 발송 기능은 없습니다.")

    class_id = select_class(key="kakao_class")
    if not class_id:
        return

    student_id = select_student(class_id, key="kakao_student")
    if not student_id:
        return

    student_names = db.student_name_map(class_id)
    student_name = student_names.get(student_id, student_id)

    records = db.get_student_records(student_id)
    if records.empty:
        st.info("이 학생의 기록이 없습니다. 먼저 '일일 기록 입력'에서 저장해 주세요.")
        return

    # Build date options (newest first — already sorted)
    date_labels = []
    for idx, row in records.iterrows():
        test_disp = format_test_display(row["테스트결과"], row["만점"])
        date_labels.append(f"{row['날짜']} · {test_disp}")

    chosen = st.selectbox(
        "기록 선택 (기본: 최신)",
        date_labels,
        index=0,
        key="kakao_record_sel",
    )
    chosen_idx = date_labels.index(chosen)
    row = records.iloc[chosen_idx]

    st.subheader("선택한 기록")
    st.write(
        {
            "날짜": row["날짜"],
            "테스트": format_test_display(row["테스트결과"], row["만점"]),
            "평균": format_average_display(row["평균"]),
            "난이도": row["난이도"],
            "과제이행률": row["과제이행률"],
            "학습진도": row["학습진도"],
            "특이사항": row["특이사항"] or "(없음)",
        }
    )

    message = format_kakao_message(
        date_str=str(row["날짜"]),
        student_name=student_name,
        test_result=format_test_display(row["테스트결과"], row["만점"]),
        average=format_average_display(row["평균"]),
        difficulty=str(row["난이도"]),
        homework_rate=str(row["과제이행률"]),
        progress=str(row["학습진도"] or ""),
        homework=str(row["과제안내"] or ""),
        notes=str(row["특이사항"] or ""),
    )

    st.subheader("생성된 문구")
    st.text_area(
        "카톡 문구",
        value=message,
        height=420,
        key="kakao_message_box",
    )
    st.code(message, language=None)
    st.caption("위 코드 블록 오른쪽 복사 버튼을 누르거나, 텍스트 박스 내용을 직접 복사하세요.")

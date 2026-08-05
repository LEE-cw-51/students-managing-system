"""반별 대시보드 화면."""

from __future__ import annotations

from datetime import date

import pandas as pd
import plotly.express as px
import streamlit as st

import sheets_utils as db
from ui_helpers import select_class


def _normalize_grade(value: str) -> str:
    """Collapse 'A(100~90%)' -> 'A', etc."""
    text = str(value or "").strip()
    if not text:
        return "미입력"
    return text[0].upper() if text[0].upper() in {"A", "B", "C"} else text


def render() -> None:
    st.header("반별 대시보드")

    class_id = select_class(key="dash_class")
    if not class_id:
        return

    students = db.list_students(class_id, active_only=True)
    student_map = db.student_name_map(class_id)
    records = db.get_class_records(class_id)

    st.markdown("#### 성적·학습 요약 (최근 기록 기준)")
    if records.empty or students.empty:
        st.info("표시할 기록이 없습니다.")
    else:
        rec = records.copy()
        rec["점수비율"] = rec.apply(
            lambda r: db.parse_score_ratio(r["테스트결과"], r["만점"]),
            axis=1,
        )
        valid_scores = rec["점수비율"].dropna()
        avg_score = round(float(valid_scores.mean()), 1) if not valid_scores.empty else None

        c1, c2, c3 = st.columns(3)
        c1.metric("재원 학생 수", len(students))
        c2.metric("총 기록 수", len(rec))
        c3.metric("반 평균 점수(%)", avg_score if avg_score is not None else "-")

        # Homework rate distribution
        hw = rec["과제이행률"].astype(str).map(_normalize_grade)
        hw_counts = hw.value_counts().reset_index()
        hw_counts.columns = ["등급", "건수"]

        if not hw_counts.empty:
            fig_hw = px.pie(
                hw_counts,
                names="등급",
                values="건수",
                title="과제이행률 등급 분포",
            )
            st.plotly_chart(fig_hw, use_container_width=True)
        else:
            st.info("과제이행률 데이터 없음")

        # Per-student latest average
        st.markdown("##### 학생별 최근 평균")
        latest_rows = []
        for sid, sname in student_map.items():
            srec = rec[rec["학생ID"].astype(str) == sid]
            if srec.empty:
                continue
            srec = srec.copy()
            srec["_d"] = pd.to_datetime(srec["날짜"], errors="coerce")
            latest = srec.sort_values("_d", ascending=False).iloc[0]
            latest_rows.append(
                {
                    "학생": sname,
                    "최근날짜": latest["날짜"],
                    "최근평균": latest["평균"],
                    "과제이행률": latest["과제이행률"],
                    "난이도": latest["난이도"],
                }
            )
        if latest_rows:
            st.dataframe(
                pd.DataFrame(latest_rows),
                use_container_width=True,
                hide_index=True,
            )

    st.divider()
    st.markdown("#### 출석 현황")
    att_date = st.date_input("출석 기준 날짜", value=date.today(), key="dash_att_date")
    date_str = att_date.isoformat()
    attendance = db.get_attendance(class_id=class_id, attendance_date=date_str)

    total_students = len(students)
    if attendance.empty:
        st.info(f"{date_str} 출결 기록이 없습니다.")
    else:
        present = attendance[attendance["출결상태"] == "출석"]
        absent = attendance[attendance["출결상태"] == "결석"]
        present_n = len(present)
        absent_n = len(absent)
        rate = round(present_n / total_students * 100, 1) if total_students else 0

        a1, a2, a3 = st.columns(3)
        a1.metric("출석인원", f"{present_n}/{total_students}")
        a2.metric("출석률", f"{rate}%")
        a3.metric("결석인원", absent_n)

        if absent_n > 0:
            st.markdown("**결석자 명단**")
            absent_names = [
                student_map.get(str(sid), str(sid))
                for sid in absent["학생ID"].astype(str)
            ]
            notes = absent["비고"].astype(str).tolist()
            absent_df = pd.DataFrame({"학생": absent_names, "비고": notes})
            st.dataframe(absent_df, use_container_width=True, hide_index=True)
        else:
            st.success("결석자가 없습니다.")

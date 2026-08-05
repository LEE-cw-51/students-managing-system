"""학생별 성적/출결 추이 화면."""

from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st

import sheets_utils as db
from templates import format_test_display
from ui_helpers import select_class, select_student


def render() -> None:
    st.header("학생별 성적/출결 추이")

    class_id = select_class(key="trend_class")
    if not class_id:
        return

    student_id = select_student(class_id, key="trend_student")
    if not student_id:
        return

    student_names = db.student_name_map(class_id)
    student_name = student_names.get(student_id, student_id)
    st.subheader(f"{student_name}")

    records = db.get_student_records(student_id)
    st.markdown("#### 성적 추이")
    if records.empty:
        st.info("기록이 없습니다.")
    else:
        chart_df = records.copy()
        chart_df["날짜_dt"] = pd.to_datetime(chart_df["날짜"], errors="coerce")
        chart_df = chart_df.dropna(subset=["날짜_dt"]).sort_values("날짜_dt")
        chart_df["점수비율"] = chart_df.apply(
            lambda r: db.parse_score_ratio(r["테스트결과"], r["만점"]),
            axis=1,
        )
        chart_df = chart_df.dropna(subset=["점수비율"])
        if chart_df.empty:
            st.info("시각화할 점수 데이터가 없습니다.")
        else:
            fig = px.line(
                chart_df,
                x="날짜_dt",
                y="점수비율",
                markers=True,
                labels={"날짜_dt": "날짜", "점수비율": "점수 비율 (%)"},
                title=f"{student_name} 테스트 점수 비율",
            )
            fig.update_layout(yaxis_range=[0, 105], height=400)
            st.plotly_chart(fig, use_container_width=True)

            recent_table = chart_df.sort_values("날짜_dt", ascending=False).head(15)
            recent_table = recent_table.copy()
            recent_table["테스트"] = recent_table.apply(
                lambda r: format_test_display(r["테스트결과"], r["만점"]),
                axis=1,
            )
            recent_table["점수비율"] = recent_table["점수비율"].round(1)
            st.dataframe(
                recent_table[["날짜", "테스트", "점수비율", "난이도", "평균"]],
                use_container_width=True,
                hide_index=True,
            )

    st.divider()
    st.markdown("#### 출결 이력")
    attendance = db.get_attendance(student_id=student_id)
    if attendance.empty:
        st.info("출결 이력이 없습니다.")
    else:
        att = attendance.copy()
        att["_date"] = pd.to_datetime(att["날짜"], errors="coerce")
        att = att.sort_values("_date", ascending=False)
        absent_count = int((att["출결상태"] == "결석").sum())
        present_count = int((att["출결상태"] == "출석").sum())
        total = len(att)

        m1, m2, m3 = st.columns(3)
        m1.metric("총 기록", total)
        m2.metric("출석", present_count)
        m3.metric("결석", absent_count)

        # Calendar-like list
        display = att[["날짜", "출결상태", "비고"]].reset_index(drop=True)
        st.dataframe(display, use_container_width=True, hide_index=True)

    st.divider()
    st.markdown("#### 특이사항 이력")
    if records.empty:
        st.info("기록이 없습니다.")
    else:
        notes = records.copy()
        notes["특이사항"] = notes["특이사항"].astype(str).str.strip()
        notes = notes[
            notes["특이사항"].notna()
            & (notes["특이사항"] != "")
            & (notes["특이사항"].str.lower() != "nan")
        ]
        if notes.empty:
            st.info("특이사항이 기록된 이력이 없습니다.")
        else:
            st.dataframe(
                notes[["날짜", "특이사항", "테스트결과", "만점"]].reset_index(drop=True),
                use_container_width=True,
                hide_index=True,
            )

"""수학의 힘 — 학원 학생 관리 업무 툴 (Streamlit)."""

from __future__ import annotations

import streamlit as st

import attendance
import auth
import class_dashboard
import class_mgmt
import daily_records
import data_export
import kakao_msg
import student_mgmt
import student_trends

st.set_page_config(
    page_title="수학의 힘 · 학생 관리",
    page_icon="📘",
    layout="wide",
    initial_sidebar_state="expanded",
)

MENU = {
    "반 관리": class_mgmt.render,
    "학생 관리": student_mgmt.render,
    "출결 체크": attendance.render,
    "일일 기록 입력": daily_records.render,
    "카톡 문구 생성": kakao_msg.render,
    "학생별 성적/출결 추이": student_trends.render,
    "반별 대시보드": class_dashboard.render,
    "데이터 내보내기": data_export.render,
}


def main() -> None:
    if "authenticated" not in st.session_state:
        st.session_state.authenticated = False

    if not auth.is_authenticated():
        auth.render_login()
        return

    with st.sidebar:
        st.title("수학의 힘")
        st.caption("학생 관리 시스템")
        page = st.radio("메뉴", list(MENU.keys()), key="main_menu")
        st.divider()
        if st.button("로그아웃", use_container_width=True):
            auth.logout()
            st.rerun()

    try:
        MENU[page]()
    except Exception as exc:  # noqa: BLE001 — surface sheet/auth errors to user
        st.error("작업을 처리하는 중 오류가 발생했습니다.")
        st.exception(exc)
        st.info(
            "Google Sheets 연결·권한·secrets 설정을 확인해 주세요. "
            "자세한 내용은 README.md를 참고하세요."
        )


if __name__ == "__main__":
    main()

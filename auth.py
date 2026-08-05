"""Simple password gate for the Streamlit app."""

from __future__ import annotations

import streamlit as st


def is_authenticated() -> bool:
    return bool(st.session_state.get("authenticated", False))


def logout() -> None:
    st.session_state.authenticated = False


def render_login() -> None:
    """Show login form. Sets session_state.authenticated on success."""
    st.title("수학의 힘 · 학생 관리")
    st.caption("학원 업무용 도구 — 비밀번호를 입력해 주세요.")

    with st.form("login_form"):
        password = st.text_input("비밀번호", type="password")
        submitted = st.form_submit_button("로그인", use_container_width=True)

    if submitted:
        expected = st.secrets.get("APP_PASSWORD", "")
        if not expected:
            st.error("APP_PASSWORD가 secrets에 설정되지 않았습니다.")
            return
        if password == expected:
            st.session_state.authenticated = True
            st.rerun()
        else:
            st.error("비밀번호가 올바르지 않습니다.")

"""일일 기록 입력 화면 — 공통 내용 / 학생별 점수 / 개별 수정."""

from __future__ import annotations

from datetime import date
from typing import Any

import streamlit as st

import sheets_utils as db
from templates import format_average_display, format_test_display
from ui_helpers import confirm_action, select_class, select_student

DIFFICULTY_OPTIONS = ["상", "중", "하"]
HOMEWORK_RATE_OPTIONS = ["A(100~90%)", "B(89~70%)", "C(70%미만)"]
COMMON_STATE_KEY = "rec_common_lesson"


def _preview_cols() -> list[str]:
    return ["날짜", "테스트", "평균", "난이도", "과제이행률", "학습진도"]


def _get_common() -> dict[str, Any] | None:
    return st.session_state.get(COMMON_STATE_KEY)


def _set_common(data: dict[str, Any]) -> None:
    st.session_state[COMMON_STATE_KEY] = data


def _clear_common() -> None:
    st.session_state.pop(COMMON_STATE_KEY, None)


def render() -> None:
    st.header("일일 기록 입력")
    st.caption(
        "① 공통 내용(진도·과제 등)을 먼저 입력한 뒤, ② 학생별 시험 점수를 저장하세요."
    )

    if st.session_state.pop("rec_save_msg", None):
        st.success(st.session_state.pop("rec_save_detail", "저장되었습니다."))

    class_id = select_class(key="rec_class")
    if not class_id:
        return

    students = db.list_students(class_id, active_only=True)
    if students.empty:
        st.info("이 반에 재원 학생이 없습니다.")
        return

    record_date = st.date_input("수업 날짜", value=date.today(), key="rec_lesson_date")
    date_str = record_date.isoformat()

    common = _get_common()
    if common and common.get("날짜") == date_str and common.get("반ID") == class_id:
        st.info(
            f"적용된 공통 내용 · {date_str} · 난이도 {common['난이도']} · "
            f"과제이행률 {common['과제이행률']} · 만점 {common['만점']}"
        )
    elif common:
        st.warning("반 또는 날짜가 바뀌었습니다. 「공통 내용」탭에서 다시 적용해 주세요.")

    tab_common, tab_scores, tab_edit = st.tabs(
        ["① 공통 내용", "② 학생별 점수", "개별 수정"]
    )

    with tab_common:
        _render_common_tab(class_id, date_str)

    with tab_scores:
        _render_scores_tab(class_id, students, date_str)

    with tab_edit:
        _render_individual(class_id)


def _render_common_tab(class_id: str, date_str: str) -> None:
    st.subheader("공통 수업 내용")
    st.caption(
        "오늘 반 전체에 공통으로 들어갈 내용입니다. "
        "적용 후 「학생별 점수」탭에서 시험 점수만 입력해 일괄 저장합니다."
    )

    prev = _get_common() or {}
    same_context = prev.get("반ID") == class_id and prev.get("날짜") == date_str

    def _idx(options: list[str], value: str, default: int = 0) -> int:
        return options.index(value) if value in options else default

    with st.form("common_lesson_form"):
        difficulty = st.selectbox(
            "난이도",
            DIFFICULTY_OPTIONS,
            index=_idx(
                DIFFICULTY_OPTIONS,
                str(prev.get("난이도", "중")) if same_context else "중",
                1,
            ),
        )
        progress = st.text_input(
            "학습진도",
            value=str(prev.get("학습진도", "")) if same_context else "",
            placeholder="예: 이차방정식 활용",
        )
        homework = st.text_area(
            "과제안내",
            value=str(prev.get("과제안내", "")) if same_context else "",
            height=120,
            placeholder="예: 문제집 20~25쪽",
        )
        homework_rate = st.selectbox(
            "과제이행률 (공통)",
            HOMEWORK_RATE_OPTIONS,
            index=_idx(
                HOMEWORK_RATE_OPTIONS,
                str(prev.get("과제이행률", HOMEWORK_RATE_OPTIONS[0]))
                if same_context
                else HOMEWORK_RATE_OPTIONS[0],
            ),
        )
        common_notes = st.text_input(
            "공통 특이사항 (선택)",
            value=str(prev.get("특이사항", "")) if same_context else "",
            placeholder="모든 학생에 동일 적용. 학생별로 다르면 점수 탭에서 개별 입력",
        )
        default_max = st.number_input(
            "공통 만점",
            min_value=1,
            step=1,
            value=int(prev.get("만점", 10)) if same_context else 10,
        )
        applied = st.form_submit_button("공통 내용 적용", type="primary")

    if applied:
        if not progress.strip() and not homework.strip():
            st.warning("학습진도 또는 과제안내 중 하나 이상 입력하는 것을 권장합니다.")
        _set_common(
            {
                "반ID": class_id,
                "날짜": date_str,
                "난이도": difficulty,
                "학습진도": progress.strip(),
                "과제안내": homework.strip(),
                "과제이행률": homework_rate,
                "특이사항": common_notes.strip(),
                "만점": int(default_max),
            }
        )
        st.session_state["rec_save_msg"] = True
        st.session_state["rec_save_detail"] = (
            "공통 내용이 적용되었습니다. 「학생별 점수」탭으로 이동해 점수를 입력하세요."
        )
        st.rerun()

    if same_context and prev:
        st.divider()
        st.markdown("#### 현재 적용된 공통 내용")
        st.write(
            {
                "날짜": prev.get("날짜"),
                "난이도": prev.get("난이도"),
                "학습진도": prev.get("학습진도") or "(없음)",
                "과제안내": prev.get("과제안내") or "(없음)",
                "과제이행률": prev.get("과제이행률"),
                "공통 특이사항": prev.get("특이사항") or "(없음)",
                "공통 만점": prev.get("만점"),
            }
        )
        if st.button("공통 내용 초기화", key="clear_common_lesson"):
            _clear_common()
            st.rerun()


def _render_scores_tab(class_id: str, students, date_str: str) -> None:
    st.subheader("학생별 테스트 점수")
    common = _get_common()
    if (
        not common
        or common.get("반ID") != class_id
        or common.get("날짜") != date_str
    ):
        st.warning(
            "먼저 「① 공통 내용」탭에서 오늘 수업 공통 내용을 입력하고 "
            "**공통 내용 적용**을 눌러 주세요."
        )
        return

    existing_ids = db.records_exist_for_class_date(class_id, date_str)
    if existing_ids:
        names = db.student_name_map(class_id)
        existing_names = [names.get(sid, sid) for sid in dict.fromkeys(existing_ids)]
        st.warning(
            f"{date_str}에 이미 기록이 있는 학생: {', '.join(existing_names)}. "
            "저장 시 해당 학생 기록은 덮어씁니다."
        )

    with st.expander("적용된 공통 내용 보기", expanded=False):
        st.write(
            {
                "난이도": common["난이도"],
                "학습진도": common["학습진도"] or "(없음)",
                "과제안내": common["과제안내"] or "(없음)",
                "과제이행률": common["과제이행률"],
                "공통 특이사항": common["특이사항"] or "(없음)",
                "공통 만점": common["만점"],
            }
        )

    st.caption(
        "체크한 학생만 저장됩니다. 맞은 개수 · 만점 · (선택) 개별 특이사항만 입력하세요."
    )

    form_nonce = st.session_state.get("rec_batch_nonce", 0)
    default_max = int(common.get("만점", 10))

    with st.form(f"batch_scores_form_{form_nonce}"):
        header = st.columns([2.2, 1.2, 1.2, 2.2])
        header[0].markdown("**학생**")
        header[1].markdown("**맞은 개수**")
        header[2].markdown("**만점**")
        header[3].markdown("**개별 특이사항**")

        entries_ui: list[dict] = []
        for _, row in students.iterrows():
            sid = str(row["학생ID"])
            sname = str(row["학생이름"])
            already = sid in existing_ids
            label = f"{sname}" + (" · 기존" if already else "")

            c1, c2, c3, c4 = st.columns([2.2, 1.2, 1.2, 2.2])
            with c1:
                include = st.checkbox(
                    label, value=True, key=f"rec_inc_{form_nonce}_{sid}"
                )
            with c2:
                score = st.number_input(
                    "맞은 개수",
                    min_value=0,
                    step=1,
                    value=0,
                    key=f"rec_score_{form_nonce}_{sid}",
                    label_visibility="collapsed",
                )
            with c3:
                max_score = st.number_input(
                    "만점",
                    min_value=1,
                    step=1,
                    value=default_max,
                    key=f"rec_max_{form_nonce}_{sid}",
                    label_visibility="collapsed",
                )
            with c4:
                note = st.text_input(
                    "개별 특이사항",
                    key=f"rec_note_{form_nonce}_{sid}",
                    label_visibility="collapsed",
                    placeholder="없으면 공통 특이사항 사용",
                )

            with st.expander(f"{sname} · 공통값 개별 수정 (선택)", expanded=False):
                use_custom = st.checkbox(
                    "이 학생만 아래 값으로 저장",
                    value=False,
                    key=f"rec_custom_{form_nonce}_{sid}",
                )
                c_diff = st.selectbox(
                    "난이도",
                    DIFFICULTY_OPTIONS,
                    index=DIFFICULTY_OPTIONS.index(common["난이도"])
                    if common["난이도"] in DIFFICULTY_OPTIONS
                    else 1,
                    key=f"rec_cdiff_{form_nonce}_{sid}",
                )
                c_prog = st.text_input(
                    "학습진도",
                    value=common.get("학습진도", ""),
                    key=f"rec_cprog_{form_nonce}_{sid}",
                )
                c_hw = st.text_area(
                    "과제안내",
                    value=common.get("과제안내", ""),
                    key=f"rec_chw_{form_nonce}_{sid}",
                    height=80,
                )
                c_rate = st.selectbox(
                    "과제이행률",
                    HOMEWORK_RATE_OPTIONS,
                    index=HOMEWORK_RATE_OPTIONS.index(common["과제이행률"])
                    if common["과제이행률"] in HOMEWORK_RATE_OPTIONS
                    else 0,
                    key=f"rec_crate_{form_nonce}_{sid}",
                )

            entries_ui.append(
                {
                    "학생ID": sid,
                    "학생이름": sname,
                    "include": include,
                    "score": score,
                    "max_score": max_score,
                    "note": note,
                    "use_custom": use_custom,
                    "custom": {
                        "난이도": c_diff,
                        "학습진도": c_prog,
                        "과제안내": c_hw,
                        "과제이행률": c_rate,
                    },
                }
            )

        overwrite = False
        if existing_ids:
            overwrite = st.checkbox(
                f"{date_str} 기존 기록을 덮어쓰겠습니다.",
                key=f"rec_overwrite_{form_nonce}",
            )

        submitted = st.form_submit_button("일괄 저장", type="primary")

    if not submitted:
        return

    selected = [e for e in entries_ui if e["include"]]
    if not selected:
        st.error("저장할 학생을 한 명 이상 선택해 주세요.")
        return

    for e in selected:
        if e["max_score"] <= 0:
            st.error(f"{e['학생이름']}: 만점은 1 이상이어야 합니다.")
            return
        if e["score"] > e["max_score"]:
            st.error(f"{e['학생이름']}: 맞은 개수는 만점을 초과할 수 없습니다.")
            return

    need_overwrite = any(e["학생ID"] in existing_ids for e in selected)
    if need_overwrite and not overwrite:
        st.error("이미 기록이 있는 학생이 있습니다. 덮어쓰기 확인 후 다시 저장해 주세요.")
        return

    common_payload = {
        "난이도": common["난이도"],
        "학습진도": common["학습진도"],
        "과제안내": common["과제안내"],
        "과제이행률": common["과제이행률"],
        "특이사항": common["특이사항"],
    }

    batch_entries = []
    for e in selected:
        item: dict = {
            "학생ID": e["학생ID"],
            "테스트결과": e["score"],
            "만점": e["max_score"],
            "특이사항": (e["note"].strip() or common["특이사항"]),
        }
        if e["use_custom"]:
            item["난이도"] = e["custom"]["난이도"]
            item["학습진도"] = e["custom"]["학습진도"].strip()
            item["과제안내"] = e["custom"]["과제안내"].strip()
            item["과제이행률"] = e["custom"]["과제이행률"]
        batch_entries.append(item)

    try:
        count = db.save_records_batch(
            date_str,
            common_payload,
            batch_entries,
            overwrite=need_overwrite and overwrite,
        )
    except ValueError as exc:
        if str(exc) == "EXISTING":
            st.error("기존 기록이 있어 저장하지 못했습니다. 덮어쓰기를 확인해 주세요.")
            return
        raise

    names = ", ".join(e["학생이름"] for e in selected)
    st.session_state["rec_save_msg"] = True
    st.session_state["rec_save_detail"] = (
        f"{date_str} 기록 {count}건 저장 완료 ({names})"
    )
    st.session_state["rec_batch_nonce"] = form_nonce + 1
    st.rerun()


def _render_individual(class_id: str) -> None:
    student_id = select_student(class_id, key="rec_edit_student")
    if not student_id:
        return

    student_names = db.student_name_map(class_id)
    student_name = student_names.get(student_id, student_id)
    records = db.get_student_records(student_id)

    mode = st.radio(
        "작업",
        ["새 기록 추가", "기존 기록 수정"],
        horizontal=True,
        key="rec_indiv_mode",
    )

    if mode == "새 기록 추가":
        _render_single_add(student_id, student_name)
        return

    if records.empty:
        st.info("수정할 기록이 없습니다. 먼저 공통 내용 + 점수 일괄 입력 또는 새 기록을 추가해 주세요.")
        return

    labels = []
    for _, row in records.iterrows():
        test = format_test_display(row["테스트결과"], row["만점"])
        labels.append(f"{row['날짜']} · {test} ({row['기록ID'][-6:]})")

    chosen = st.selectbox("기록 선택", labels, key="rec_edit_sel")
    row = records.iloc[labels.index(chosen)]
    record_id = str(row["기록ID"])

    form_nonce = st.session_state.get("rec_edit_nonce", 0)
    with st.form(f"edit_record_form_{form_nonce}"):
        try:
            default_d = date.fromisoformat(str(row["날짜"]))
        except ValueError:
            default_d = date.today()
        edit_date = st.date_input("날짜", value=default_d)
        c1, c2 = st.columns(2)
        with c1:
            try:
                score_default = int(float(row["테스트결과"]))
            except (TypeError, ValueError):
                score_default = 0
            score = st.number_input(
                "테스트 맞은 개수", min_value=0, step=1, value=score_default
            )
        with c2:
            try:
                max_default = int(float(row["만점"]))
            except (TypeError, ValueError):
                max_default = 10
            max_score = st.number_input(
                "만점", min_value=1, step=1, value=max(max_default, 1)
            )

        diff = str(row.get("난이도", "중") or "중")
        diff_idx = DIFFICULTY_OPTIONS.index(diff) if diff in DIFFICULTY_OPTIONS else 1
        difficulty = st.selectbox("난이도", DIFFICULTY_OPTIONS, index=diff_idx)

        progress = st.text_input("학습진도", value=str(row.get("학습진도", "") or ""))
        homework = st.text_area(
            "과제안내", value=str(row.get("과제안내", "") or ""), height=100
        )
        rate = str(
            row.get("과제이행률", HOMEWORK_RATE_OPTIONS[0]) or HOMEWORK_RATE_OPTIONS[0]
        )
        rate_idx = (
            HOMEWORK_RATE_OPTIONS.index(rate) if rate in HOMEWORK_RATE_OPTIONS else 0
        )
        homework_rate = st.selectbox("과제이행률", HOMEWORK_RATE_OPTIONS, index=rate_idx)
        notes = st.text_input("특이사항", value=str(row.get("특이사항", "") or ""))
        saved = st.form_submit_button("수정 저장", type="primary")

    if saved:
        if score > max_score:
            st.error("맞은 개수는 만점을 초과할 수 없습니다.")
            return
        ok = db.update_record(
            record_id,
            {
                "날짜": edit_date.isoformat(),
                "테스트결과": score,
                "만점": max_score,
                "난이도": difficulty,
                "학습진도": progress.strip(),
                "과제안내": homework.strip(),
                "과제이행률": homework_rate,
                "특이사항": notes.strip(),
            },
        )
        if ok:
            st.session_state["rec_save_msg"] = True
            st.session_state["rec_save_detail"] = (
                f"{student_name} 학생 기록이 수정되었습니다."
            )
            st.session_state["rec_edit_nonce"] = form_nonce + 1
            st.rerun()
        else:
            st.error("수정에 실패했습니다.")

    st.divider()
    confirmed = confirm_action(
        f"이 기록({row['날짜']})을 삭제합니다.",
        key=f"rec_del_confirm_{record_id}",
    )
    if st.button("기록 삭제", disabled=not confirmed, key=f"rec_del_btn_{record_id}"):
        db.delete_record(record_id)
        st.session_state["rec_save_msg"] = True
        st.session_state["rec_save_detail"] = (
            f"{student_name} 학생 기록이 삭제되었습니다."
        )
        st.rerun()


def _render_single_add(student_id: str, student_name: str) -> None:
    recent = db.get_student_records(student_id)
    if not recent.empty:
        with st.expander("최근 기록 (참고)", expanded=False):
            preview = recent.head(5).copy()
            preview["테스트"] = preview.apply(
                lambda r: format_test_display(r["테스트결과"], r["만점"]),
                axis=1,
            )
            st.dataframe(
                preview[_preview_cols()],
                use_container_width=True,
                hide_index=True,
            )

    record_date = st.date_input("날짜", value=date.today(), key="single_add_date")
    date_str = record_date.isoformat()
    existing = db.find_records_for_date(student_id, date_str)
    overwrite = False
    if not existing.empty:
        st.warning(f"{date_str} 기록이 이미 있습니다. 저장 시 덮어씁니다.")
        overwrite = confirm_action(
            "기존 기록을 덮어쓰겠습니다.",
            key="single_overwrite_confirm",
        )

    # Prefill from applied common lesson when available
    common = _get_common()
    use_common = bool(
        common and common.get("날짜") == date_str
    )

    form_nonce = st.session_state.get("rec_single_nonce", 0)
    with st.form(f"single_record_form_{form_nonce}", clear_on_submit=True):
        c1, c2 = st.columns(2)
        with c1:
            score = st.number_input("테스트 맞은 개수", min_value=0, step=1, value=0)
        with c2:
            max_default = int(common["만점"]) if use_common else 10
            max_score = st.number_input(
                "만점", min_value=1, step=1, value=max_default
            )
        difficulty = st.selectbox(
            "난이도",
            DIFFICULTY_OPTIONS,
            index=DIFFICULTY_OPTIONS.index(common["난이도"])
            if use_common and common["난이도"] in DIFFICULTY_OPTIONS
            else 1,
        )
        progress = st.text_input(
            "학습진도",
            value=common.get("학습진도", "") if use_common else "",
        )
        homework = st.text_area(
            "과제안내",
            value=common.get("과제안내", "") if use_common else "",
            height=100,
        )
        homework_rate = st.selectbox(
            "과제이행률",
            HOMEWORK_RATE_OPTIONS,
            index=HOMEWORK_RATE_OPTIONS.index(common["과제이행률"])
            if use_common and common["과제이행률"] in HOMEWORK_RATE_OPTIONS
            else 0,
        )
        notes = st.text_input(
            "특이사항 (선택)",
            value=common.get("특이사항", "") if use_common else "",
        )
        submitted = st.form_submit_button(
            "저장",
            type="primary",
            disabled=(not existing.empty and not overwrite),
        )

    if not submitted:
        return

    if score > max_score:
        st.error("맞은 개수는 만점을 초과할 수 없습니다.")
        return

    try:
        _rid, avg = db.add_record(
            student_id=student_id,
            record_date=date_str,
            score=score,
            max_score=max_score,
            difficulty=difficulty,
            progress=progress.strip(),
            homework=homework.strip(),
            homework_rate=homework_rate,
            notes=notes.strip(),
            overwrite=overwrite,
        )
    except ValueError as exc:
        if str(exc) == "EXISTING":
            st.error("기존 기록이 있습니다. 덮어쓰기를 확인해 주세요.")
            return
        raise

    st.session_state["rec_save_msg"] = True
    st.session_state["rec_save_detail"] = (
        f"{student_name} 학생 기록이 저장되었습니다. "
        f"(테스트 {format_test_display(score, max_score)}, "
        f"최근 평균 {format_average_display(avg)})"
    )
    st.session_state["rec_single_nonce"] = form_nonce + 1
    st.rerun()

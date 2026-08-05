"""일일 기록 입력 화면 — 공통 일괄 입력 + 개별 수정."""

from __future__ import annotations

from datetime import date

import streamlit as st

import sheets_utils as db
from templates import format_average_display, format_test_display
from ui_helpers import confirm_action, select_class, select_student

DIFFICULTY_OPTIONS = ["상", "중", "하"]
HOMEWORK_RATE_OPTIONS = ["A(100~90%)", "B(89~70%)", "C(70%미만)"]


def _preview_cols() -> list[str]:
    return ["날짜", "테스트", "평균", "난이도", "과제이행률", "학습진도"]


def render() -> None:
    st.header("일일 기록 입력")
    st.caption(
        "시험 점수는 학생별로, 학습진도·과제 등은 반 공통으로 한 번에 입력할 수 있습니다."
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

    tab_batch, tab_edit = st.tabs(["일괄 입력", "개별 수정"])

    with tab_batch:
        _render_batch(class_id, students)

    with tab_edit:
        _render_individual(class_id)


def _render_batch(class_id: str, students) -> None:
    record_date = st.date_input("날짜", value=date.today(), key="rec_batch_date")
    date_str = record_date.isoformat()

    existing_ids = db.records_exist_for_class_date(class_id, date_str)
    if existing_ids:
        names = db.student_name_map(class_id)
        existing_names = [names.get(sid, sid) for sid in dict.fromkeys(existing_ids)]
        st.warning(
            f"{date_str}에 이미 기록이 있는 학생: {', '.join(existing_names)}. "
            "저장 시 해당 학생 기록은 덮어씁니다."
        )

    st.subheader("공통 내용")
    form_nonce = st.session_state.get("rec_batch_nonce", 0)
    with st.form(f"batch_record_form_{form_nonce}"):
        difficulty = st.selectbox("난이도", DIFFICULTY_OPTIONS, index=1)
        progress = st.text_input("학습진도")
        homework = st.text_area("과제안내", height=100)
        homework_rate = st.selectbox("과제이행률", HOMEWORK_RATE_OPTIONS)
        common_notes = st.text_input("공통 특이사항 (선택)", placeholder="모든 학생에 동일 적용")
        default_max = st.number_input("공통 만점", min_value=1, step=1, value=10)

        st.subheader("학생별 테스트 점수")
        st.caption("체크한 학생만 저장됩니다. 개별 특이사항이 있으면 공통 특이사항보다 우선합니다.")

        entries_ui: list[dict] = []
        for _, row in students.iterrows():
            sid = str(row["학생ID"])
            sname = str(row["학생이름"])
            already = sid in existing_ids
            label = f"{sname}" + (" · 기존기록 있음" if already else "")

            c1, c2, c3, c4 = st.columns([2.2, 1, 1.2, 1.2])
            with c1:
                include = st.checkbox(label, value=True, key=f"rec_inc_{form_nonce}_{sid}")
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
                    value=int(default_max),
                    key=f"rec_max_{form_nonce}_{sid}",
                    label_visibility="collapsed",
                )
            with c4:
                note = st.text_input(
                    "개별 특이사항",
                    key=f"rec_note_{form_nonce}_{sid}",
                    label_visibility="collapsed",
                    placeholder="개별 특이사항",
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
                    index=1,
                    key=f"rec_cdiff_{form_nonce}_{sid}",
                )
                c_prog = st.text_input("학습진도", key=f"rec_cprog_{form_nonce}_{sid}")
                c_hw = st.text_area("과제안내", key=f"rec_chw_{form_nonce}_{sid}", height=80)
                c_rate = st.selectbox(
                    "과제이행률",
                    HOMEWORK_RATE_OPTIONS,
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

    common = {
        "난이도": difficulty,
        "학습진도": progress.strip(),
        "과제안내": homework.strip(),
        "과제이행률": homework_rate,
        "특이사항": common_notes.strip(),
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
            common,
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
        st.info("수정할 기록이 없습니다. 먼저 일괄 입력 또는 새 기록을 추가해 주세요.")
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
        # date as text to avoid timezone issues with existing values
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
            score = st.number_input("테스트 맞은 개수", min_value=0, step=1, value=score_default)
        with c2:
            try:
                max_default = int(float(row["만점"]))
            except (TypeError, ValueError):
                max_default = 10
            max_score = st.number_input("만점", min_value=1, step=1, value=max(max_default, 1))

        diff = str(row.get("난이도", "중") or "중")
        diff_idx = DIFFICULTY_OPTIONS.index(diff) if diff in DIFFICULTY_OPTIONS else 1
        difficulty = st.selectbox("난이도", DIFFICULTY_OPTIONS, index=diff_idx)

        progress = st.text_input("학습진도", value=str(row.get("학습진도", "") or ""))
        homework = st.text_area(
            "과제안내", value=str(row.get("과제안내", "") or ""), height=100
        )
        rate = str(row.get("과제이행률", HOMEWORK_RATE_OPTIONS[0]) or HOMEWORK_RATE_OPTIONS[0])
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
        st.session_state["rec_save_detail"] = f"{student_name} 학생 기록이 삭제되었습니다."
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

    form_nonce = st.session_state.get("rec_single_nonce", 0)
    with st.form(f"single_record_form_{form_nonce}", clear_on_submit=True):
        c1, c2 = st.columns(2)
        with c1:
            score = st.number_input("테스트 맞은 개수", min_value=0, step=1, value=0)
        with c2:
            max_score = st.number_input("만점", min_value=1, step=1, value=10)
        difficulty = st.selectbox("난이도", DIFFICULTY_OPTIONS, index=1)
        progress = st.text_input("학습진도")
        homework = st.text_area("과제안내", height=100)
        homework_rate = st.selectbox("과제이행률", HOMEWORK_RATE_OPTIONS)
        notes = st.text_input("특이사항 (선택)")
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

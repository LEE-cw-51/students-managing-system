"""KakaoTalk (카톡) notification message templates."""

from __future__ import annotations

from typing import Any


def format_kakao_message(
    *,
    date_str: str,
    student_name: str,
    test_result: str,
    average: str,
    difficulty: str,
    homework_rate: str,
    progress: str,
    homework: str,
    notes: str = "",
) -> str:
    """
    Build the parent notification text.

    특이사항 is included only when notes has a non-empty value.
    """
    lines = [
        f"<{date_str}>",
        "안녕하세요, 수학의 힘 입니다.",
        f"오늘 {student_name} 학생 학습 알림입니다.",
        "",
        f"1. 테스트: {test_result} (평균: {average} / 난이도: {difficulty})",
        f"2. 과제이행률: {homework_rate}",
        f"3. 학습 진도: {progress}",
        "4. 과제 안내:",
        f"{homework}",
    ]

    notes_clean = (notes or "").strip()
    if notes_clean:
        lines.append(f"5. 특이사항: {notes_clean}")

    lines.extend(
        [
            "",
            "궁금하신 점이 있으시면 언제든지 문의해주시길 바랍니다.",
            "항상 최선을 다해 지도하겠습니다. 감사합니다.",
            "",
            "이찬우 드림",
            "연락처: 010-4552-4496",
        ]
    )
    return "\n".join(lines)


def format_test_display(score: Any, max_score: Any) -> str:
    """Format score as '맞은개수/만점'."""
    try:
        s = int(float(score))
        m = int(float(max_score))
        return f"{s}/{m}"
    except (TypeError, ValueError):
        return f"{score}/{max_score}"


def format_average_display(avg: Any) -> str:
    try:
        return f"{float(avg):.1f}"
    except (TypeError, ValueError):
        return str(avg) if avg is not None else "-"

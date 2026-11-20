# Phase A 다음 실행 계획

- 상위 로드맵: [voice-ai-agent-roadmap.md](./voice-ai-agent-roadmap.md)
- 기준일: 2026-11-19
- 목표: **음성(B) 전에** 인앱에서 수업 직후 기록을 제안·검토·승인할 수 있게 하고, 이름 해석 평가 세트로 회귀 게이트를 건다.

## 현황 한 줄

인앱은 읽기 10 + 쓰기 6. 수업 기록 쓰기·승인 전 편집(ProposalCard overrides)·발화 평가 세트(`tests/agent-eval/`, ≥40)가 들어갔다.

## 작업 패키지

### A1. 인앱 수업 기록 쓰기 노출 (첫 코딩 PR 후보)

**무엇을**

- `save_lesson`, `update_lesson`, 필요 시 `save_class_session`(진도·반 숙제)을 `surfaces: ['assistant', 'mcp']`로 연다.
- 숙제 체크(`save_homework_checks` 등)는 dogfooding 빈도에 따라 A1에 넣거나 A1.5로 나눈다. **한 PR에 MCP 전체 write를 인앱에 복제하지 않는다.**

**왜**

- 출결만으로는 수업 직후 가치가 반쪽이다. 점수·진도가 인앱에 있어야 받아쓰기(B)가 의미 있다.
- 구현체는 `src/agent-actions/lessons.js`에 이미 있음 → surface만 열고 프롬프트/테스트를 맞추면 된다.

**키 파일**

- `src/agent-actions/lessons.js` (및 숙제면 `homework.js`)
- `lib/agent-tools.js` (assistantTools 구성 — 등록은 actions에서 자동)
- `tests/agent-action-registry.test.js`, `tests/agent-actions.test.js`

**완료 기준**

- 인앱 채팅에서 "민수 오늘 테스트 85점, 진도 이차함수"류가 제안으로 올라가고, 승인 후 수동 화면과 같은 데이터가 남는다.
- assistant write 목록이 문서/테스트와 일치한다.

### A2. 승인 전 편집 (edit-before-approve)

**무엇을**

- `ProposalCard`: 선택뿐 아니라 call별 args(또는 표시 필드)를 고친 뒤 apply.
- apply API가 수정된 args를 받거나, 클라이언트에서 편집된 calls로 재preview 후 반영하는 안전한 경로를 정한다(검증·verify 유지).

**키 파일**

- `components/shell/AgentPanel.js` (`ProposalCard`)
- `src/07_Agent.js` / `lib/proposals.js` / `app/api/agent/apply`
- 관련 `tests/agent.test.js`

**완료 기준**

- 체크 해제 + 점수/이름 오타 수정 후 반영이 가능하고, 잘못된 편집은 preview에서 막힌다.

### A3. 발화·지시 평가 세트 (B 게이트)

**무엇을**

- `tests/`에 실제에 가까운 한국어 지시 30~50개와 기대 tool name(+핵심 args) 쌍.
- 성 생략, 별명, 동명이인, 반 맥락, "기록 없음" 되묻기를 포함.
- CI에서 돌릴 수 있는 단위(모델 호출 없이 fixture 해석기, 또는 고정 스냅샷 + 소수 라이브 태그).

**키 파일**

- `tests/` (신규 `agent-eval` 또는 동등)
- 문맥 구성: `lib/agent.js` (및 관련 helpers)

**완료 기준 (= B 진입 조건)**

- 평가 세트 회귀가 로컬/CI에서 통과.
- 이름 해석 실패 케이스가 이슈로 추적 가능.

### A4. (선택) 인앱 쓰기 범위 문서화

- README 또는 이 폴더에 assistant vs MCP write 목록 표를 한 번 더 고정해, 이후 "전부 열어달라" 요청의 기준점으로 쓴다.

## 종료 조건 (Phase A → B)

1. A1 인앱에서 성적·진도(수업 기록) 제안·승인 가능  
2. A2 승인 전 편집 가능  
3. A3 평가 세트 30~50 + 회귀 통과  

셋 중 **A3는 필수 게이트**. A2가 늦으면 A1+A3만으로 dogfooding은 가능하나, B(받아쓰기) 전에는 A2를 넣는 것을 권장한다.

## 지금 하지 말 것

- **Phase B** STT / MediaRecorder / Blob 백그라운드 받아쓰기
- **Phase F** Realtime WebRTC
- MCP write 전량을 인앱에 복제
- ADR-0002 완화(Claude에서 승인)
- 상업화·요금·법적 검토·근무처 UI 제품화
- 무관한 UI polish

## 권장 첫 코딩 PR

**제목 초안:** `Expose lesson write tools to in-app assistant`

**범위:** A1만 — `update_lesson` / `save_lesson` (+ 합의하면 `save_class_session`) assistant surface, 레지스트리·액션 테스트 갱신, 로드맵 표의 인앱 write 수 업데이트.

**다음 PR:** A2 edit-before-approve → A3 eval set.

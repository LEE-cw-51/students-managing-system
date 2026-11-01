# 화면별 레이아웃·사용성·모바일 개선 — 이어서 하기

마지막 작업: 2026-11-02. 브랜치 `ccr-3061ec46-nyk7gk`.

## 진행 상황

| 순서 | 화면 | 상태 |
|---|---|---|
| 0 | 공통 틀(사이드바·상단 막대·밀도) | 완료 |
| 1 | 오늘 / 수업 기록 | 완료 (와이어프레임 v3) |
| 2 | 학생 상세 | 완료 (v4) |
| 3 | 학생 목록 | 완료 (v5, 현재 잠금) |
| 4 | 반 상세 | **다음 차례** — 와이어프레임부터 |
| 5 | 반 목록 / 반 등록 폼 | 대기 |
| 6 | 보고서(일간·월간) | 대기 |
| 7 | 시험 / 시험대비 기간 | 대기 |
| 8 | 설정 | 대기 |

화면별로 확정된 결정과 가정은 `define.md`의 "화면 N" 절에 있다.

## 진행 방식 (화면마다 반복)

1. 해당 화면 코드를 읽고 저화질 와이어프레임(데스크톱 + 휴대폰 390px)을 그린다.
2. 사용자에게 보여 주고, 결정이 필요한 질문은 추천안과 함께 묻는다.
3. 사용자가 확정하면 구현한다. 확정 전에는 화면 코드를 고치지 않는다.
4. 확인: `npm test`, `npm run build`(기존 `lib/monthly-pdf.js` Turbopack 경고는 무시), dev 서버에서 1440px·390px 캡처와 주요 동작 점검.
5. 확인용으로 만든 데이터는 지운다.

### 로컬 PC에서 (ui-preflight 플러그인 있음)

```
node "C:\Users\chanw\.claude\plugins\cache\ui-preflight\ui-preflight\0.2.0\skills\preflight\scripts\preflight.mjs" status
... reopen --reason "반 상세 화면 구성"
... new --note "class detail screen"        # v6 생성
... check --keep sidebar,topbar,brand,nav,sidebar-foot
... approve --quote "<사용자가 확정한 말 그대로>"
```

와이어프레임은 `wireframes/vN.html`(lofi.css 규칙: `data-region`, `data-layout`, 그리드 최대 6열).

### 클라우드에서 (플러그인 없음)

preflight CLI는 없으므로 `wireframes/v5.html`을 복사해 `v6.html`을 만들고 같은 lofi.css 규칙으로 화면을 추가한다. 캡처는 Playwright로 찍어 보여 준다. 잠금 파일(`layout.lock.yaml`, `state.json`)은 건드리지 않는다. 로컬로 돌아오면 `new`/`approve`로 정리한다.

## dev 서버

PowerShell:
```
$env:LMS_STORE="file"; $env:AUTH_SECRET="dev"; $env:LMS_PASSWORD="dev"; $env:AI_API_KEY="placeholder"; npm run dev
```
bash: `LMS_STORE=file AUTH_SECRET=dev LMS_PASSWORD=dev AI_API_KEY=placeholder npm run dev`

포트 8787. 로그인: `fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'dev'})})`.
데이터 파일은 `dev-server/data.json`(커밋 안 됨). 클라우드에서는 빈 상태로 시작하므로 반·학생을 화면에서 먼저 만든다.

## 공통 원칙

- 데이터와 업무 로직(`src/`, `lib/`)은 바꾸지 않는다. 꼭 필요하면 기존 서비스 함수를 재사용한다.
- 휴대폰(640px 이하): 표는 `stack-mobile`로 쌓거나 카드형. 터치 대상 42px 이상.
- 같은 패턴을 쓴다: 한 줄 제목 줄(제목 + 핵심 정보, 오른쪽에 동작), 휴대폰 탭 넘침 표시(`components/ui/Tabs.js`의 opt-in prop), 삭제는 확인 창 대신 5초 되돌리기(`useNoteDelete`), 저장 안 한 변경은 `ConfirmDialog`.
- 스킬: `refactoring-ui`(밀도·위계), `web-design-guidelines`(점검), `a11y-audit`(키보드·터치).

## 남은 화면의 개선 후보

4. **반 상세** (`app/(lms)/classes/[id]/page.js`, `components/domain/class/ClassTabs.js`, `PlansTab.js`)
   - 수업 데이터를 고치는 편집기가 셋이다. 정리 방향을 와이어프레임에서 제안한다.
   - 숙제 표에서 바로 편집할 수 있는지 검토한다.
   - 삭제 버튼 스타일을 통일한다.
   - 휴대폰: 숙제 표(`.hw-matrix`)와 6개월 통계 표가 옆으로 넘친다.
5. **반 목록 / 반 등록** (`components/domain/class/ClassForm.js`)
   - 가장 긴 등록 폼. 필수 항목만 먼저 받고 나머지는 단계로 나누거나 접는다.
6. **보고서** (`components/domain/report/DailyReports.js`, `MonthlyBoard.js`)
   - 일간에 "전체 복사", 월간에 일괄 확정과 일괄 PDF.
   - URL의 `class` 파라미터가 탭마다 뜻이 다르다. 분리한다.
   - 휴대폰: 표의 체크박스 칸과 동작 칸에 라벨.
7. **시험 / 시험대비 기간** (`app/(lms)/exams/page.js`, `components/domain/exam/Planner.js`)
   - 일괄 입력 표를 휴대폰에서 세로로 쌓는다.
   - 기간 편성 화면을 구획으로 나누고, 표 안의 별도 스크롤을 없앤다.
8. **설정** (`app/(lms)/settings/page.js`)
   - 저장 안 하고 떠날 때 확인.
   - 긴 안내 문구를 접는다.

## 알려진 점

- 학생 목록의 상담 기록 표에는 후속 할 일 진행 상태 칸이 없다(`listCounselingNotes`가 상태를 주지 않음; `src/` 변경이 필요해 보류).
- `.preflight/shots/`는 `.gitignore`라 캡처는 저장소에 없다. 와이어프레임 HTML을 브라우저로 열면 된다.

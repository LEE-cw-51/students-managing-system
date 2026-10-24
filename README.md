# 학생 관리 시스템

강사용 학생 관리 웹앱입니다. 수업 기록, 성적 통계, 상담 일지를 관리합니다. 브라우저는 **Next.js API**만 호출하고, 데이터는 **Postgres**에 둡니다.

```text
브라우저 (Next.js React 화면)
        ↓  /api/*
Next.js (검증 · 통계 · 보고서)
        ↓  SQL
Postgres (Students, Classes, Lessons, ...)
```

Google Apps Script / 시트 왕복은 사용하지 않습니다.

## 로컬 실행

Node.js 22+ 와 `.env.local`이 필요합니다.

```bash
cp .env.example .env.local
# DATABASE_URL, AUTH_SECRET, LMS_PASSWORD 를 채웁니다.

npm test
npm run dev
```

브라우저에서 `http://127.0.0.1:8787` 로 접속합니다. 로그인 비밀번호는 `LMS_PASSWORD`입니다. 샘플 데이터가 필요하면 `npm run seed` 를 한 번 실행하세요.

Postgres 없이 화면만 확인하려면 개발 전용 파일 저장소를 씁니다(운영 빌드에서는 꺼집니다). 처음 실행할 때 데모 반·학생·수업 기록이 자동으로 들어갑니다.

```bash
LMS_STORE=file AUTH_SECRET=dev LMS_PASSWORD=dev npm run dev   # 데이터: dev-server/data.json
```

## 화면 구성

| 메뉴 | 내용 |
|---|---|
| 오늘 | 주간 띠, 수업 카드, 할 일(상담 후속 포함), D-7 학교 시험, 주의 학생, 이번 주 숙제 확인, 보강 추가 · 반을 누르면 **수업 기록**(반 공통 → 지난 숙제 확인 → 오늘 숙제 → 학생별, 한 번에 저장) |
| 학생 | 목록(필터·검색·경고 배지·다음 시험) · 상세 탭: 개요, 출결 달력, 수업 기록, 숙제, 성적, 상담(후속 조치), 보고서, 반 이력 · 전체 상담 기록 |
| 반 | 정규/시험대비 목록 · 상세 탭: 개요, 진도 기록, 숙제 기록, 테스트 기록, 강의 계획, 학생, 통계 · 요일별 수업 시간(숫자 입력: 1800 → 18:00) |
| 시험 | 학교별 수학 시험 일정·범위 · 시험대비 기간(학교+학년 임시 반 편성, 원래 반 휴강, 학생별 시험 종료 후 바로 복귀) |
| 보고서 | 일간(반·날짜별 미리보기·복사) · 월간(상태표, 기본/AI 일괄 생성, 편집·확정·PDF) |
| 설정 | 학원 정보, 보고서 문구, 과제 등급 기준, 새 학년도 학년 올리기 |

화면 위 검색창(`Ctrl+K` 또는 `/`)에서 학생 이름·학교·전화 뒷자리, 반 이름으로 바로 이동합니다.

## 데이터베이스

테이블은 `lms.kv` 한 곳에 JSON으로 저장합니다. 학원 규모에서는 이 구조가 단순하고, Apps Script 시트 읽기보다 훨씬 빠릅니다.

- `Students`, `Classes`, `StudentClasses`, `Lessons`, `ClassPlans`, `HomeworkItems`, `HomeworkChecks`, `MonthlyReports`, `Settings`, `_Meta`
- 수업 기록 고유 키는 `lesson_date + student_id + class_id`
- 강의 계획(`ClassPlans`) 고유 키는 `class_id + period_type(일간|주간|월간) + period_key`
- 숙제 항목(`HomeworkItems`)은 반·수업일별 칸, 완료(`HomeworkChecks`)는 `item_id + student_id`
- 반 단위 수업(`ClassSessions`)은 `lesson_date + class_id` 한 건: 진도·수업 내용·테스트 정보·공지. 저장하면 학생별 수업 기록에도 진도·만점이 복사되어 기존 보고서·통계가 그대로 동작합니다
- 반 시간표는 `Classes.schedule`(요일별 시작·종료), `weekday/start_time/end_time`은 호환용 파생값
- 학교 시험(`SchoolExams`), 시험대비 기간(`ExamPeriods`), 임시 배정(`StudentClasses.status = '임시'`, 시작·종료일)
- 데이터 구조 변경은 `_Meta`의 스키마 버전으로 처음 접속할 때 한 번 자동 적용됩니다(다시 실행해도 결과 동일)
- 학생 퇴원·반 종료는 행을 지우지 않고 상태를 바꿉니다

스키마 SQL은 `supabase/migrations/` 에 있습니다.

## 배포 (Vercel)

1. 이 저장소를 Vercel 프로젝트에 연결합니다.
2. 환경 변수 `DATABASE_URL`, `AUTH_SECRET`, `LMS_PASSWORD`를 넣습니다.
   `DATABASE_URL`은 Supabase **Session pooler**(6543) 주소를 씁니다.
   월간 보고서 **AI 분석**은 OpenRouter를 사용합니다. [openrouter.ai/keys](https://openrouter.ai/keys)에서 발급한 키를 `AI_API_KEY`에 넣습니다. 모델을 지정하지 않으면 `openrouter/free`가 그 요청에 쓸 수 있는 무료 모델 중 하나를 고릅니다. 특정 모델로 고정하려면 `AI_MODEL`을 추가합니다.
3. 함수는 `icn1`(서울)에서 실행되어 서울 Postgres와 가깝습니다.

빈 데이터베이스에서 반과 학생을 바로 등록하면 됩니다. 로컬에서 샘플 화면만 보려면 `npm run seed` 로 데모 3명을 넣을 수 있습니다.

## 보안

- 웹앱은 비밀번호 세션으로 막습니다. 비밀번호는 서버 환경 변수에만 둡니다.
- 브라우저에 데이터베이스 키를 넣지 않습니다. 모든 읽기/쓰기는 서버 API를 통과합니다.
- AI API 키는 서버 환경 변수에만 두며, 월간 보고서 생성 시 수업·성적·상담 요약 JSON이 OpenRouter로 전송됩니다.

## 강의 계획

- **위치**: 반 상세 → `강의 계획` 탭에서 일간·주간·월간 계획을 작성·수정합니다. 일간 계획은 `진도 기록` 탭에서 실제 진도와 나란히, 수업 기록 화면 위쪽에 보입니다.
- **기간 키**: 일간은 날짜, 주간은 그 주 월요일, 월간은 `YYYY-MM`입니다. 같은 반·기간은 한 건으로 upsert됩니다.

## 숙제 체크리스트

- **수업 기록**: 오늘 내줄 숙제를 칸별로 입력하고, 직전 수업 숙제는 학생별 체크리스트로 확인합니다(확인 전이면 모두 완료로 시작해 안 한 것만 해제).
- **과제 이행률**: 체크 비율로 A(90%+) / B(70%+) / C가 자동 계산됩니다.
- **이번 주 숙제 확인**: 오늘 화면에서 각 수업일의 직전 수업 숙제 완료 상황을 봅니다. 반 상세 `숙제 기록` 탭에서 학생별 완료 표를 봅니다.
- 테스트 통계는 **100점 환산 없이** 만점이 같은 원점수만 평균합니다.

## 월간 보고서 (AI · PDF)

- **기본 보고서**: 기존처럼 통계 템플릿으로 문장을 만듭니다. 보고서 → 월간에서 반 단위로 일괄 생성할 수 있습니다(확정본은 건드리지 않음).
- **AI 분석 포함**: 보고서 → 월간에서 학생별 또는 선택한 학생 일괄로(2명씩) 생성하면, 같은 달 수업·상담·학습 신호를 바탕으로 `【학습 분석】`, `【학생 피드백·관찰】`, `【다음 달 지도 제안】` 구간을 추가합니다.
- **PDF 저장**: 보고서 편집 창의 **PDF 저장**으로 다운로드합니다 (한글 폰트는 서버에서 자동 로드하거나 `public/fonts/`에 OTF를 둘 수 있습니다).

## 프로젝트 구조

```text
app/(lms)/      React 화면 (오늘·학생·반·시험·보고서·설정)
app/api/        API (/api/[name] 은 업무 API를 그대로 호출)
components/     공통 UI(components/ui) · 화면별 부품(components/domain)
lib/            세션 · Postgres 저장소 · 화면용 API 클라이언트
src/00_Core.js  도메인 상수 · 순수 계산 · 보고서 문장
src/01_Service.js  저장소에 의존하지 않는 업무 API
src/05_Views.js 화면용 조회 API (반·학생·오늘·시험·보고서)
scripts/        시드 · 개발용 데모 데이터
tests/          Node 테스트
```

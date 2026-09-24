# 학생 관리 시스템

강사용 학생 관리 웹앱입니다. 수업 기록, 성적 통계, 상담 일지를 관리합니다. 브라우저는 **Next.js API**만 호출하고, 데이터는 **Postgres**에 둡니다.

```text
브라우저 (기존 LMS 화면)
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

## 데이터베이스

테이블은 `lms.kv` 한 곳에 JSON으로 저장합니다. 학원 규모에서는 이 구조가 단순하고, Apps Script 시트 읽기보다 훨씬 빠릅니다.

- `Students`, `Classes`, `StudentClasses`, `Lessons`, `MonthlyReports`, `Settings`, `_Meta`
- 수업 기록 고유 키는 `lesson_date + student_id + class_id`
- 학생 퇴원·반 종료는 행을 지우지 않고 상태를 바꿉니다

스키마 SQL은 `supabase/migrations/` 에 있습니다.

## 배포 (Vercel)

1. 이 저장소를 Vercel 프로젝트에 연결합니다.
2. 환경 변수 `DATABASE_URL`, `AUTH_SECRET`, `LMS_PASSWORD`를 넣습니다.
   `DATABASE_URL`은 Supabase **Session pooler**(6543) 주소를 씁니다.
   월간 보고서 **AI 분석**을 쓰려면 `AI_API_KEY`(또는 `OPENAI_API_KEY`)와 필요 시 `AI_MODEL`, `AI_BASE_URL`을 추가합니다.
3. 함수는 `icn1`(서울)에서 실행되어 서울 Postgres와 가깝습니다.

빈 데이터베이스에서 반과 학생을 바로 등록하면 됩니다. 로컬에서 샘플 화면만 보려면 `npm run seed` 로 데모 3명을 넣을 수 있습니다.

## 보안

- 웹앱은 비밀번호 세션으로 막습니다. 비밀번호는 서버 환경 변수에만 둡니다.
- 브라우저에 데이터베이스 키를 넣지 않습니다. 모든 읽기/쓰기는 서버 API를 통과합니다.
- AI API 키는 서버 환경 변수에만 두며, 월간 보고서 생성 시 수업·성적·상담 요약 JSON이 LLM 제공업체로 전송됩니다.

## 월간 보고서 (AI · PDF)

- **기본 보고서**: 기존처럼 통계 템플릿으로 문장을 만듭니다.
- **AI 분석 포함**: `월간보고서` 화면에서 학생·연월 선택 후 **AI 분석 포함**을 누르면, 같은 달 수업·상담·학습 신호를 바탕으로 `【학습 분석】`, `【특이사항·관찰】`, `【다음 달 지도 제안】` 구간을 추가합니다.
- **PDF 저장**: 생성된 미리보기 아래 **PDF 저장**으로 다운로드합니다 (한글 폰트는 서버에서 자동 로드하거나 `public/fonts/`에 OTF를 둘 수 있습니다).

## 프로젝트 구조

```text
app/            Next.js 화면 · API
lib/            세션 · Postgres 저장소
src/00_Core.js  도메인 상수 · 순수 계산 · 보고서 문장
src/01_Service.js  저장소에 의존하지 않는 업무 API
public/lms-client.js  기존 화면 스크립트
tests/          Node 테스트
```

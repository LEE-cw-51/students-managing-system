# 수학의 힘 · 학습관리 시스템 v1

Google Sheets를 **공식 데이터베이스**로 사용하는 학원 학습관리 웹앱입니다.

```text
브라우저 (반응형 HTML/CSS/JS)
        ↓  google.script.run
Google Apps Script (API · 검증 · 통계 · 보고서)
        ↓  getValues / setValues
Google Sheets (Students, Classes, StudentClasses, Lessons, ...)
```

웹앱은 시트를 직접 조작하지 않습니다. 모든 읽기/쓰기는 Apps Script API를 통과합니다.

첫 화면 데이터는 웹앱 HTML에 같이 실어 보내고, 이후 화면은 브라우저 캐시와 Apps Script `CacheService`로 시트 왕복을 줄입니다. `google.script.run` 자체 지연은 남아 있지만, 페이지마다 시트를 여러 번 읽거나 수업 저장 때 시트 전체를 다시 쓰는 경로는 제거했습니다.

## 1차 완성 범위

- 대시보드
- 학생 등록 · 수정 · 퇴원(상태 변경) · 반 이동 이력
- 반 등록 · 수정 · 종료 · 학생 배정
- 오늘의 수업 일괄 입력 (전체 적용 + 학생별 수정)
- 일일 보고서 생성 · 복사 (카카오톡 붙여넣기용)
- 월간 통계 · 월간 보고서 임시/확정 저장
- 학생별 · 반별 통계
- 학원/보고서 설정

Excel 가져오기, PDF, 스프레드시트 백업 복제는 다음 단계입니다.

## 로컬에서 UI 확인 (Google 계정 없이)

Node.js 22+가 있으면 시트 없이 같은 API를 JSON 파일로 흉내 냅니다.

```bash
npm test
npm run dev
```

브라우저에서 `http://127.0.0.1:8787` 로 접속합니다. 최초 실행 시 중2 A반 데모 데이터가 들어갑니다.

## Google에 배포 (clasp)

1. [Apps Script API](https://script.google.com/home/usersettings) 를 사용 설정합니다.
2. clasp를 설치하고 로그인합니다.

```bash
npm i -g @google/clasp
clasp login
```

3. 스탠드얼론 스크립트를 만듭니다.

```bash
clasp create --title "수학의힘 LMS" --type standalone --rootDir src
```

생성 후 `.clasp.json`의 `scriptId`가 채워집니다. `src/appsscript.json`은 유지합니다.

4. 코드를 올립니다.

```bash
clasp push
```

5. Apps Script 편집기에서 **배포 → 새 배포 → 웹 앱**:

| 항목 | 권장 값 |
|------|---------|
| 실행 주체 | 나 |
| 액세스 권한 | 나 자신 (또는 허용된 Google 계정만) |

익명 공개 배포는 사용하지 마세요.

6. 스크립트 속성 `SPREADSHEET_ID`를 넣을 수 있습니다.

- 비어 있으면 첫 요청 때 `수학의힘_LMS_DB` 스프레드시트를 만들고 ID를 저장합니다.
- 이미 쓸 시트가 있으면 [프로젝트 설정 → 스크립트 속성]에 `SPREADSHEET_ID`를 넣습니다.

시트는 웹앱 첫 실행 시 아래 탭과 헤더를 자동 생성합니다.

## 데이터베이스 (시트 = 테이블)

1행은 컬럼명, 2행부터 데이터입니다. 관계 연결에는 이름 대신 ID를 씁니다.

| 시트 | 역할 |
|------|------|
| Students | 학생. `STU_000001` |
| Classes | 반. `CLS_000001` |
| StudentClasses | 학생-반 이력. `REL_000001` |
| Lessons | 일일 수업/학습 원본. `LES_000001` |
| MonthlyReports | 확정/임시 월간 보고서. 원본이 아님 |
| Settings | 학원명, 인사말, 과제 A/B/C 기준 등 |
| _Meta | ID 시퀀스 |

날짜는 `YYYY-MM-DD`로 저장하고, 화면에서만 `2026년 9월 10일 목요일`로 표시합니다.

수업 기록 고유 키는 `lesson_date + student_id + class_id` 입니다. 같으면 UPDATE, 없으면 INSERT 합니다.

학생 퇴원·반 종료는 행을 지우지 않고 상태를 바꿉니다. 과거 Lessons의 `class_id`는 반 이동 후에도 그대로입니다.

테스트 평균은 `test_score / test_max_score × 100` 으로 정규화합니다. `미실시`와 만점 0은 평균에서 제외하고 `-`로 표시합니다.

## 보안

- 웹앱을 공개(익명)로 배포하지 않습니다.
- 설정 화면의 `allowed_emails`에 허용할 Google 계정을 쉼표로 넣을 수 있습니다. 비우면 배포 권한(나 자신)에만 의존합니다.
- 보호자 연락처 등 불필요한 개인정보는 넣지 않는 것을 권장합니다.

## 프로젝트 구조

```text
src/00_Core.js      도메인 상수 · 순수 계산 · 보고서 문장
src/01_Service.js   저장소에 의존하지 않는 업무 API
src/02_Db.js        Google Sheets 저장소 (LockService, 일괄 읽기/쓰기)
src/03_Api.js       google.script.run 공개 함수
src/04_Code.js      doGet
src/Index.html      셸
src/Styles.html     반응형 스타일
src/Client.html     화면 · 라우팅
tests/              Node 테스트
dev-server/         로컬 미리보기
```

## 개발 원칙

1. Google Sheets가 Source of Truth다.
2. 웹앱은 Sheet API를 직접 호출하지 않는다.
3. 관계는 ID로만 연결한다.
4. 보고서는 Lessons에서 필요할 때 생성한다. 완성 문장을 시트 셀에 저장하지 않는다.
5. 월간 통계도 Lessons에서 계산한다.

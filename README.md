# 수학의 힘 · 학생 관리 시스템

Streamlit 기반 학원 학생 관리 업무 툴입니다.  
Google Sheets를 DB로 사용하며, Streamlit Community Cloud에 무료 배포할 수 있습니다.

## 기능

| 메뉴 | 설명 |
|------|------|
| 반 관리 | 반 목록 조회·추가·삭제 |
| 학생 관리 | 반별 학생 추가·삭제·반 이동 |
| 출결 체크 | 날짜별 반 전체 출석/결석 일괄 저장 |
| 일일 기록 입력 | 테스트·진도·과제·집중도 등 기록 + 최근 평균 |
| 카톡 문구 생성 | 학부모 알림 문구 자동 생성 (복사 붙여넣기용) |
| 학생별 성적/출결 추이 | Plotly 점수 차트 + 출결·특이사항 이력 |
| 반별 대시보드 | 반 평균·등급 분포·출석률 |
| 데이터 내보내기 | Records / Attendance CSV 다운로드 |

## 시트 구성 (Google Sheets)

스프레드시트에 아래 4개 시트가 필요합니다.  
앱 최초 실행 시 시트가 없으면 자동 생성·헤더를 맞춥니다.

1. **Classes** — 반ID, 반이름, 담당쌤, 생성일  
2. **Students** — 학생ID, 반ID, 학생이름, 학년, 전화번호, 부모님연락처, 등록일, 상태(재원/퇴원)  
3. **Records** — 기록ID, 학생ID, 날짜, 테스트결과, 만점, 평균, 난이도, 학습진도, 과제안내, 과제이행률, 특이사항  
4. **Attendance** — 출결ID, 학생ID, 반ID, 날짜, 출결상태(출석/결석), 비고  

## 1. Google 서비스 계정 생성 및 시트 공유

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트 생성  
2. **API 및 서비스 → 라이브러리**에서 아래 API 사용 설정  
   - Google Sheets API  
   - Google Drive API  
3. **IAM 및 관리자 → 서비스 계정**에서 서비스 계정 생성  
4. 생성된 서비스 계정의 **키 → 키 추가 → JSON** 다운로드  
5. Google Sheets에서 새 스프레드시트 생성 (또는 기존 시트 사용)  
6. 시트 **공유**에 서비스 계정 이메일(`client_email`)을 **편집자**로 추가  
7. 시트 URL에서 ID 확인:  
   `https://docs.google.com/spreadsheets/d/`**`SHEET_ID`**`/edit`

> JSON 키 파일은 절대 Git에 커밋하지 마세요. `.gitignore`에 `*.json`이 포함되어 있습니다.

## 2. secrets 설정

### 로컬

```bash
cp .streamlit/secrets.toml.example .streamlit/secrets.toml
```

`.streamlit/secrets.toml`에 다음 값을 채웁니다.

| 키 | 설명 |
|----|------|
| `APP_PASSWORD` | 앱 로그인 비밀번호 |
| `SHEET_ID` | Google Spreadsheet ID |
| `gcp_service_account` | 서비스 계정 JSON 전체 필드 (`type`, `project_id`, `private_key`, `client_email` 등) |

예시 구조:

```toml
APP_PASSWORD = "your-password"
SHEET_ID = "your-sheet-id"

[gcp_service_account]
type = "service_account"
project_id = "..."
private_key_id = "..."
private_key = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
client_email = "...@....iam.gserviceaccount.com"
client_id = "..."
auth_uri = "https://accounts.google.com/o/oauth2/auth"
token_uri = "https://oauth2.googleapis.com/token"
auth_provider_x509_cert_url = "https://www.googleapis.com/oauth2/v1/certs"
client_x509_cert_url = "..."
```

### Streamlit Community Cloud

앱 배포 후 **Settings → Secrets**에 위와 동일한 TOML 내용을 붙여넣습니다.

## 3. 로컬 실행

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
streamlit run app.py
```

브라우저에서 `http://localhost:8501` 접속 후 `APP_PASSWORD`로 로그인합니다.

## 4. Streamlit Community Cloud 배포

1. 이 저장소를 GitHub에 push  
2. [share.streamlit.io](https://share.streamlit.io/) (또는 [streamlit.io/cloud](https://streamlit.io/cloud))에 로그인  
3. **New app** → 저장소·브랜치 선택  
4. Main file path: `app.py`  
5. **Advanced settings → Secrets**에 `secrets.toml` 내용 입력  
6. Deploy  

배포 후에도 Google 시트에 서비스 계정이 공유되어 있어야 합니다.

## 프로젝트 구조

```
app.py                 # 진입점 · 로그인 · 사이드바 메뉴
auth.py                # 비밀번호 로그인
sheets_utils.py        # Google Sheets CRUD
templates.py           # 카톡 문구 템플릿
ui_helpers.py          # 반/학생 선택 공통 UI
class_mgmt.py          # 반 관리
student_mgmt.py        # 학생 관리
attendance.py          # 출결 체크
daily_records.py       # 일일 기록 입력
kakao_msg.py           # 카톡 문구 생성
student_trends.py      # 성적/출결 추이
class_dashboard.py     # 반별 대시보드
data_export.py         # CSV 내보내기
requirements.txt
.streamlit/secrets.toml.example
```

## 보안 주의사항

- `.streamlit/secrets.toml`, 서비스 계정 `*.json`, `.env`는 커밋하지 마세요.  
- 코드에 비밀번호·API 키·서비스계정 JSON을 하드코딩하지 마세요.  
- 앱 비밀번호(`APP_PASSWORD`)는 주기적으로 변경하는 것을 권장합니다.

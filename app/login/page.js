import Script from 'next/script';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const errored = params?.error === '1';
  return (
    <div className="login-wrap">
      <form className="card login-card" method="POST" action="/api/login">
        <div className="brand login-brand">
          <div className="brand-mark" aria-hidden="true">학</div>
          <div>
            <h1 className="display">학생 관리 시스템</h1>
            <p className="muted">수업 · 성적 · 상담 관리</p>
          </div>
        </div>
        {errored ? <div className="login-error" role="alert">비밀번호가 올바르지 않습니다.</div> : null}
        <div className="field">
          <label htmlFor="password">비밀번호</label>
          <div className="password-row">
            <input id="password" name="password" type="password" autoFocus required />
            <button className="btn secondary" id="toggle-password" type="button" aria-controls="password" aria-pressed="false">표시</button>
          </div>
        </div>
        <button className="btn" type="submit">들어가기</button>
      </form>
      <Script id="login-password-toggle" strategy="afterInteractive">
        {`document.getElementById('toggle-password').addEventListener('click', function () {
          var input = document.getElementById('password');
          var show = input.type === 'password';
          input.type = show ? 'text' : 'password';
          this.textContent = show ? '숨기기' : '표시';
          this.setAttribute('aria-pressed', show ? 'true' : 'false');
          input.focus();
        });`}
      </Script>
    </div>
  );
}

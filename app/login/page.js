import Script from 'next/script';
import { safeNext } from '../../lib/safe-next.js';

export const dynamic = 'force-dynamic';

const ERRORS = {
  1: '이메일 또는 비밀번호가 올바르지 않습니다.',
  3: '로그인 중 오류가 발생했습니다. 잠시 뒤에 다시 시도해 주세요.'
};

function errorMessage(code) {
  const lockedMinutes = /^locked-(\d{1,3})$/.exec(String(code || ''))?.[1];
  if (lockedMinutes) return `로그인 시도가 너무 많습니다. 약 ${lockedMinutes}분 뒤에 다시 시도해 주세요.`;
  return ERRORS[code] || '';
}

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const error = errorMessage(params?.error);
  const next = safeNext(params?.next);
  return (
    <div className="login-wrap">
      <form className="card login-card" method="POST" action="/api/login">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <div className="brand login-brand">
          <div className="brand-mark" aria-hidden="true">학</div>
          <div>
            <h1 className="display">학생 관리 시스템</h1>
            <p className="muted">수업 · 성적 · 상담 관리</p>
          </div>
        </div>
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <div className="field">
          <label htmlFor="email">이메일</label>
          <input id="email" name="email" type="email" autoComplete="username" autoFocus required />
        </div>
        <div className="field">
          <label htmlFor="password">비밀번호</label>
          <div className="password-row">
            <input id="password" name="password" type="password" autoComplete="current-password" required />
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

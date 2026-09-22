export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const errored = params?.error === '1';
  return (
    <div className="login-wrap">
      <form className="card login-card" method="POST" action="/api/login">
        <h1>학생 관리 시스템</h1>
        <p className="muted">수업 · 성적 · 상담 관리</p>
        {errored ? <div className="login-error">비밀번호가 올바르지 않습니다.</div> : null}
        <div className="field">
          <label htmlFor="password">비밀번호</label>
          <input id="password" name="password" type="password" autoFocus required />
        </div>
        <button className="btn" type="submit">들어가기</button>
      </form>
    </div>
  );
}

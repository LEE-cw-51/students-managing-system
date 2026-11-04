import { redirect } from 'next/navigation';
import { isAuthed } from '../../../lib/auth.js';
import { issueAuthorizationCode, redirectWithParams, validateAuthorizeParams } from '../../../lib/oauth.js';

export const dynamic = 'force-dynamic';

const FIELDS = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'];

function pick(source) {
  const out = {};
  FIELDS.forEach((k) => {
    const v = typeof source.get === 'function' ? source.get(k) : source[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === 'string' && s) out[k] = s;
  });
  return out;
}

async function decide(formData) {
  'use server';
  const params = pick(formData);
  const next = `/oauth/authorize?${new URLSearchParams(params).toString()}`;
  if (!(await isAuthed())) redirect(`/login?next=${encodeURIComponent(next)}`);
  const v = validateAuthorizeParams(params);
  if (v.fatal) redirect(next);
  if (v.error) {
    redirect(redirectWithParams(v.redirectUri, { error: v.error, error_description: v.description, state: v.state }));
  }
  if (formData.get('decision') !== 'allow') {
    redirect(redirectWithParams(v.redirectUri, { error: 'access_denied', state: v.state }));
  }
  const code = await issueAuthorizationCode(v);
  redirect(redirectWithParams(v.redirectUri, { code, state: v.state }));
}

function Shell({ children }) {
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand login-brand">
          <div className="brand-mark" aria-hidden="true">학</div>
          <div>
            <h1 className="display">학생 관리 시스템</h1>
            <p className="muted">Claude 커넥터 연결</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export default async function AuthorizePage({ searchParams }) {
  const params = pick((await searchParams) || {});
  const query = new URLSearchParams(params).toString();
  if (!(await isAuthed())) {
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize${query ? `?${query}` : ''}`)}`);
  }
  const v = validateAuthorizeParams(params);
  if (v.fatal) {
    return (
      <Shell>
        <div className="login-error" role="alert">{v.error}</div>
        <p className="muted">Claude에서 커넥터 연결을 처음부터 다시 시도해 주세요.</p>
      </Shell>
    );
  }
  if (v.error) {
    redirect(redirectWithParams(v.redirectUri, { error: v.error, error_description: v.description, state: v.state }));
  }
  return (
    <Shell>
      <form action={decide}>
        {Object.entries(params).map(([k, val]) => (
          <input key={k} type="hidden" name={k} value={val} />
        ))}
        <h2 className="oauth-title">{v.clientName}에 학생 관리 접근을 허용할까요?</h2>
        <ul className="oauth-scope">
          <li>학생, 반, 출결, 성적, 숙제, 상담 기록을 조회합니다.</li>
          <li>설정 화면의 Claude 커넥터 쓰기 모드에 따라 출결·상담·할 일을 변경할 수 있습니다.</li>
          <li>설정 화면의 &quot;연결 끊기&quot;로 언제든 접근을 해제할 수 있습니다.</li>
        </ul>
        <p className="muted oauth-target">돌아갈 주소: {new URL(v.redirectUri).host}</p>
        <div className="oauth-actions">
          <button className="btn secondary" type="submit" name="decision" value="deny">거부</button>
          <button className="btn" type="submit" name="decision" value="allow">허용</button>
        </div>
      </form>
    </Shell>
  );
}

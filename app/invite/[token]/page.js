import { MIN_PASSWORD_LENGTH, peekInvite } from '../../../lib/accounts.js';

export const dynamic = 'force-dynamic';

const ERRORS = {
  mismatch: '두 비밀번호가 서로 다릅니다.',
  weak: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`,
  invalid: '링크가 만료되었거나 이미 사용되었습니다. 관리자에게 새 링크를 요청해 주세요.',
  taken: '이미 등록된 이메일입니다. 로그인 화면에서 로그인해 주세요.',
  server: '처리 중 오류가 발생했습니다. 잠시 뒤에 다시 시도해 주세요.',
  limited: '시도가 너무 많습니다. 15분 뒤에 다시 시도해 주세요.'
};

function Shell({ subtitle, children }) {
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand login-brand">
          <div className="brand-mark" aria-hidden="true">학</div>
          <div>
            <h1 className="display">학생 관리 시스템</h1>
            <p className="muted">{subtitle}</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export default async function InvitePage({ params, searchParams }) {
  const { token } = await params;
  const query = (await searchParams) || {};
  let invite = null;
  let loadError = '';
  try {
    invite = await peekInvite(token);
  } catch (e) {
    loadError = ERRORS.server;
  }
  if (!invite) {
    return (
      <Shell subtitle="계정 링크">
        <div className="login-error" role="alert">{loadError || ERRORS.invalid}</div>
        <p className="muted"><a href="/login">로그인 화면으로</a></p>
      </Shell>
    );
  }
  const reset = invite.purpose === 'reset';
  const error = ERRORS[query.error] || '';
  return (
    <Shell subtitle={reset ? '비밀번호 재설정' : '강사 계정 만들기'}>
      <form method="POST" action="/api/invite">
        <input type="hidden" name="token" value={token} />
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <div className="field">
          <label htmlFor="email">이메일</label>
          <input id="email" type="email" value={invite.email} autoComplete="username" readOnly />
        </div>
        {reset ? null : (
          <div className="field">
            <label htmlFor="name">이름</label>
            <input id="name" name="name" defaultValue={invite.name} maxLength={50} autoComplete="name" />
          </div>
        )}
        <div className="field">
          <label htmlFor="password">새 비밀번호 ({MIN_PASSWORD_LENGTH}자 이상)</label>
          <input id="password" name="password" type="password" minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" autoFocus required />
        </div>
        <div className="field">
          <label htmlFor="password2">새 비밀번호 확인</label>
          <input id="password2" name="password2" type="password" minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" required />
        </div>
        <button className="btn" type="submit">{reset ? '비밀번호 바꾸고 들어가기' : '계정 만들고 들어가기'}</button>
      </form>
    </Shell>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Field, { focusInvalid } from '@/components/ui/Field';
import Modal, { ModalCancel } from '@/components/ui/Modal';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { ApiError, useApi } from '@/lib/client-api';

const ROLE_LABEL = { admin: '관리자', teacher: '강사' };
const MEMBER_LABEL = { owner: '소유', member: '멤버' };

/** GET (no body) or JSON POST to /api/admin/*. Throws ApiError with the server message. */
async function adminApi(path, body) {
  let res;
  try {
    res = await fetch('/api/admin/' + path, body === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    throw new ApiError('서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.');
  }
  if (res.status === 401) {
    window.location.href = '/login?next=%2Fadmin%2Fusers';
    throw new ApiError('로그인이 필요합니다.');
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new ApiError('서버 응답을 읽을 수 없습니다.');
  if (!data.ok) throw new ApiError(data.error || '요청을 처리하지 못했습니다.', data.code);
  return data.data;
}

function formatExpiry(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Shows a one-time link (invite or password reset) with a copy button; it cannot be shown again. */
function LinkModal({ link, onClose }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(window.location.origin + link.path), [link.path]);
  const copy = () => navigator.clipboard.writeText(url).then(
    () => toast('링크를 복사했습니다.'),
    () => {
      inputRef.current?.select();
      toast('복사하지 못했습니다. 링크를 직접 선택해 복사해 주세요.', 'error');
    }
  );
  return (
    <Modal title={link.title} onClose={onClose}
      footer={<><ModalCancel>닫기</ModalCancel><button type="button" className="btn" disabled={!url} onClick={copy}>링크 복사</button></>}>
      <div className="stack-sm">
        <p className="adm-link-lead">{link.lead}</p>
        <Field label="링크" hint={`${formatExpiry(link.expires_at)}까지 한 번만 쓸 수 있습니다.`}>
          {(id) => <input id={id} ref={inputRef} value={url} readOnly onFocus={(e) => e.target.select()} />}
        </Field>
        <p className="adm-link-warn" role="note">이 창을 닫으면 링크를 다시 볼 수 없습니다. 잃어버리면 새 링크를 발급해 주세요(이전 링크는 그때 사용할 수 없게 됩니다).</p>
      </div>
    </Modal>
  );
}

function InviteModal({ workspace, ttlHours, onClose, onCreated }) {
  const toast = useToast();
  const formRef = useRef(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'teacher', workspace: 'new' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e && e.target ? e.target.value : e }));
    if (key === 'email') setError(null);
  };
  const dirty = !!(form.email.trim() || form.name.trim());
  const submit = async (e) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('이메일 형식이 올바르지 않습니다.');
      focusInvalid(formRef.current);
      return;
    }
    setBusy(true);
    try {
      const res = await adminApi('invites', form);
      onCreated(res);
    } catch (err) {
      if (err.code === 'EMAIL_TAKEN' || /이메일/.test(err.message)) {
        setError(err.message);
        focusInvalid(formRef.current);
      } else {
        toast(err.message, 'error');
      }
    } finally {
      setBusy(false);
    }
  };
  const mineLabel = workspace.name ? `내 작업공간 (${workspace.name})` : '내 작업공간';
  return (
    <Modal title="강사 초대" onClose={onClose} dirty={dirty}
      footer={<><ModalCancel /><button type="submit" form="adm-invite-form" className="btn" disabled={busy}>{busy ? '만드는 중…' : '초대 링크 만들기'}</button></>}>
      <form id="adm-invite-form" ref={formRef} className="form-grid" onSubmit={submit} noValidate>
        <Field label="이메일" error={error} hint="이 이메일로 로그인합니다.">
          {(id) => <input id={id} type="email" autoComplete="off" value={form.email} onChange={set('email')} aria-invalid={error ? 'true' : undefined} required />}
        </Field>
        <Field label="이름" hint="비워 두면 강사가 직접 입력합니다.">
          {(id) => <input id={id} value={form.name} maxLength={50} onChange={set('name')} />}
        </Field>
        <Field label="역할" hint={form.role === 'admin' ? '관리자는 계정 관리 화면을 쓸 수 있습니다.' : '자기 작업공간의 학생·반만 다룹니다.'}>
          {(id) => (
            <select id={id} value={form.role} onChange={set('role')}>
              <option value="teacher">강사</option>
              <option value="admin">관리자</option>
            </select>
          )}
        </Field>
        <div className="field span-all">
          <span className="adm-label" id="adm-ws-label">작업공간</span>
          <div className="segmented adm-ws" role="group" aria-labelledby="adm-ws-label">
            <button type="button" aria-pressed={form.workspace === 'new'} onClick={() => set('workspace')('new')}>새 작업공간</button>
            <button type="button" aria-pressed={form.workspace === 'mine'} onClick={() => set('workspace')('mine')}>{mineLabel}</button>
          </div>
          <span className="hint">
            {form.workspace === 'new'
              ? '강사 혼자 쓰는 빈 작업공간을 새로 만듭니다. 내 학생 데이터는 보이지 않습니다.'
              : '내 작업공간에 멤버로 들어와 지금 있는 학생·반 데이터를 함께 보고 고칠 수 있습니다.'}
          </span>
        </div>
        <p className="hint span-all" style={{ margin: 0 }}>링크는 {ttlHours}시간 동안 한 번만 쓸 수 있습니다. 같은 이메일로 다시 만들면 이전 초대 링크는 사용할 수 없게 됩니다.</p>
      </form>
    </Modal>
  );
}

function UserRow({ user, me, onReset, onToggle, busy }) {
  const isMe = user.id === me;
  return (
    <tr className={user.disabled ? 'adm-off' : undefined}>
      <td className="primary">
        <span className="adm-email">{user.email}</span>
        {isMe ? <span className="tag muted">나</span> : null}
      </td>
      <td data-label="이름">{user.name || <span className="muted">-</span>}</td>
      <td data-label="역할"><span className={'tag ' + (user.role === 'admin' ? '' : 'muted')}>{ROLE_LABEL[user.role] || user.role}</span></td>
      <td data-label="작업공간">
        {user.workspaces.length ? user.workspaces.map((w) => (
          <div key={w.id}>{w.name || '이름 없음'} <span className="muted">· {MEMBER_LABEL[w.role] || w.role}</span></div>
        )) : <span className="tag warn">없음</span>}
      </td>
      <td data-label="상태">{user.disabled ? <span className="tag danger">비활성</span> : <span className="tag ok">사용 중</span>}</td>
      <td data-label="관리">
        <span className="cluster adm-actions">
          <button type="button" className="btn sm secondary" disabled={busy || user.disabled} onClick={() => onReset(user)}
            title={user.disabled ? '비활성 계정은 먼저 다시 사용하게 해 주세요.' : undefined}>비밀번호 재설정 링크</button>
          {user.disabled ? (
            <button type="button" className="btn sm secondary" disabled={busy} onClick={() => onToggle(user, false)}>다시 사용</button>
          ) : (
            <button type="button" className="btn sm secondary" disabled={busy || isMe} onClick={() => onToggle(user, true)}
              title={isMe ? '지금 로그인한 계정은 비활성화할 수 없습니다.' : undefined}>비활성화</button>
          )}
        </span>
      </td>
    </tr>
  );
}

export default function UsersAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const state = useApi(() => adminApi('users'), []);
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState(null);
  const [busyId, setBusyId] = useState('');

  const users = state.data ? state.data.users : [];
  const disabledCount = users.filter((u) => u.disabled).length;

  const reset = async (user) => {
    const ok = await confirm({
      title: '비밀번호 재설정 링크',
      message: `${user.email} 계정의 비밀번호 재설정 링크를 만듭니다. 링크로 새 비밀번호를 정하면 이 계정은 다른 기기에서 모두 로그아웃됩니다. 전에 만든 재설정 링크는 사용할 수 없게 됩니다.`,
      confirmLabel: '링크 만들기'
    });
    if (!ok) return;
    setBusyId(user.id);
    try {
      const res = await adminApi(`users/${encodeURIComponent(user.id)}/reset`, {});
      setLink({ title: '비밀번호 재설정 링크', lead: `${user.email} 님에게 이 링크를 전달해 주세요.`, ...res });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId('');
    }
  };

  const toggle = async (user, disabled) => {
    if (disabled) {
      const ok = await confirm({
        title: '계정 비활성화',
        message: `${user.email} 계정을 비활성화합니다. 바로 로그아웃되고 다시 로그인할 수 없습니다. 작업공간 데이터는 지워지지 않습니다.`,
        confirmLabel: '비활성화',
        danger: true
      });
      if (!ok) return;
    }
    setBusyId(user.id);
    try {
      const next = await adminApi(`users/${encodeURIComponent(user.id)}/disabled`, { disabled });
      state.setData((d) => ({ ...d, users: d.users.map((u) => (u.id === next.id ? { ...u, ...next } : u)) }));
      toast(disabled ? '계정을 비활성화했습니다.' : '계정을 다시 사용할 수 있게 했습니다.');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId('');
    }
  };

  const created = (res) => {
    setInviting(false);
    setLink({ title: '초대 링크', lead: `${res.email} 님에게 이 링크를 전달해 주세요. 링크에서 비밀번호를 정하면 계정이 만들어집니다.`, ...res });
  };

  return (
    <div className="admin-page">
      <PageHeader
        title="계정 관리"
        sub={state.data ? `계정 ${users.length}개${disabledCount ? ` · 비활성 ${disabledCount}개` : ''}` : null}
        actions={<button type="button" className="btn" disabled={!state.data} onClick={() => setInviting(true)}>강사 초대</button>}
      />
      <Async state={state}>
        {(d) => d.users.length ? (
          <div className="table-wrap">
            <table className="data-table stack-mobile adm-table">
              <thead>
                <tr><th>이메일</th><th>이름</th><th>역할</th><th>작업공간</th><th>상태</th><th>관리</th></tr>
              </thead>
              <tbody>
                {d.users.map((u) => (
                  <UserRow key={u.id} user={u} me={d.me} busy={busyId === u.id} onReset={reset} onToggle={toggle} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card"><EmptyState title="계정이 없습니다" /></div>
        )}
      </Async>
      {inviting && state.data ? (
        <InviteModal workspace={state.data.workspace} ttlHours={state.data.invite_ttl_hours}
          onClose={() => setInviting(false)} onCreated={created} />
      ) : null}
      {link ? <LinkModal link={link} onClose={() => setLink(null)} /> : null}
    </div>
  );
}

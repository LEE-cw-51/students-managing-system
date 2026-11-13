'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import LMS from '../../../src/00_Core.js';
import PageHeader from '@/components/ui/PageHeader';
import Field from '@/components/ui/Field';
import Modal from '@/components/ui/Modal';
import { Async } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';

const GRADE_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];
const SECTIONS = [
  { id: 'academy', title: '학원 정보', keys: ['academy_name', 'teacher_name', 'contact'] },
  { id: 'report', title: '보고서 문구', keys: ['report_greeting', 'report_closing'] },
  { id: 'assignment', title: '과제 이행 등급 기준', keys: GRADE_KEYS.map((g) => `assignment_${g}`) },
  { id: 'mcp', title: 'Claude 커넥터', keys: ['mcp_write_mode'] }
];
const MCP_MODES = [
  { value: 'read_only', label: '조회만', hint: 'Claude는 학생·반·수업·숙제·시험 등 모든 데이터를 읽기만 하고, 아무것도 바꿀 수 없습니다.' },
  { value: 'proposal', label: '승인 대기 제안', hint: 'Claude가 학생·반·수업·숙제·시험 등 모든 데이터의 추가·수정·삭제를 요청할 수 있습니다. Claude가 요청한 변경은 모두 AI 비서 패널의 승인 대기에 올라가고, 앱에서 승인해야만 저장됩니다. 승인과 거절은 앱에서만 할 수 있고, Claude 대화에서는 할 수 없습니다. 설정은 바꿀 수 없습니다.' }
];
const mcpModeOf = (v) => MCP_MODES.find((m) => m.value === LMS.normalizeMcpWriteMode(v)) || MCP_MODES[0];
const KEYS = SECTIONS.flatMap((s) => s.keys);
const PLACEHOLDERS = { ...LMS.DEFAULT_SETTINGS, academy_name: '학원' };
const PREVIEW_NAME = '○○○';

const value = (obj, key) => (obj && obj[key]) || '';

function useUnsavedGuard(dirty) {
  const router = useRouter();
  const confirm = useConfirm();
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]');
      const href = a ? a.getAttribute('href') || '' : '';
      if (!a || a.target === '_blank' || a.hasAttribute('download') || !href || href.startsWith('#') || href.startsWith('tel:') || href.startsWith('mailto:')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      e.stopPropagation();
      confirm({
        title: '저장하지 않은 설정',
        message: '설정 저장을 누르지 않은 변경이 있습니다. 이 화면을 떠날까요?',
        confirmLabel: '저장하지 않고 떠나기',
        danger: true
      }).then((ok) => {
        if (ok) router.push(url.pathname + url.search + url.hash);
      });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, confirm, router]);
}

function HelpRow({ text, label, children }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="st-help-row">
        <span>{text}</span>
        <button type="button" className="st-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>{label}</button>
      </div>
      {open ? <div id={id} className="st-more-body">{children}</div> : null}
    </>
  );
}

function SectionHead({ title, changed, children }) {
  return (
    <div className="st-head">
      <h2>{title}</h2>
      {children}
      {changed ? <span className="st-changed">● 변경</span> : null}
    </div>
  );
}

function ReportPreview({ form, date }) {
  const [open, setOpen] = useState(false);
  const greeting = form.report_greeting || LMS.DEFAULT_SETTINGS.report_greeting;
  const closing = form.report_closing || LMS.DEFAULT_SETTINGS.report_closing;
  const teacher = form.teacher_name || LMS.DEFAULT_SETTINGS.teacher_name;
  const contact = form.contact || LMS.DEFAULT_SETTINGS.contact;
  const head = ['<' + LMS.formatKoreanDate(date) + '>', greeting, '오늘 ' + PREVIEW_NAME + ' 학생 학습 알림입니다.'].join('\n');
  const tail = [closing, '', teacher + ' 드림', '연락처: ' + contact].join('\n');
  return (
    <div className={'st-preview' + (open ? ' open' : '')}>
      <strong className="st-preview-title">일일 보고서 미리보기</strong>
      <button type="button" className="st-preview-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>미리보기</button>
      <div className="st-preview-body" aria-live="polite">
        <div className="st-preview-text">{head}</div>
        <div className="st-preview-gap">… 테스트·과제·진도 (학생마다 다름) …</div>
        <div className="st-preview-text">{tail}</div>
      </div>
    </div>
  );
}

function PromotionModal({ onClose, onDone }) {
  const toast = useToast();
  const state = useApi(() => api('previewGradePromotion'), []);
  const [busy, setBusy] = useState(false);
  const total = state.data ? state.data.total : 0;
  const run = async () => {
    setBusy(true);
    try {
      const res = await api('promoteGrades');
      toast(`${res.updated_count}명의 학년을 올렸습니다.`);
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="학년 올리기 (새 학년도)" onClose={onClose} className="st-promo-modal"
      footer={<><button type="button" className="btn secondary" onClick={onClose}>취소</button><button type="button" className="btn" disabled={busy || !total} onClick={run}>{busy ? '처리 중…' : `${total}명 학년 올리기`}</button></>}>
      <Async state={state}>
        {(d) => (
          <div className="stack-sm">
            <p className="st-promo-notice">재원생 <strong>{d.total}명</strong>의 학년을 한 단계씩 올립니다. 한 번에 되돌릴 수 없고, 학생 정보에서 한 명씩 고쳐야 합니다.</p>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>지금</th><th>바뀐 후</th><th className="num">학생 수</th></tr></thead>
                <tbody>
                  {d.items.filter((i) => i.count).map((i) => <tr key={i.from_grade}><td>{i.from_grade}</td><td>{i.to_grade}</td><td className="num">{i.count}명</td></tr>)}
                </tbody>
              </table>
            </div>
            {d.skipped.length ? <p className="hint" style={{ margin: 0 }}>고3·기타 학년 {d.skipped.length}명은 그대로 둡니다: {d.skipped.map((s) => s.name).join(', ')}</p> : null}
          </div>
        )}
      </Async>
    </Modal>
  );
}

const stamp = (v) => String(v || '').slice(0, 16).replace('T', ' ');

function McpConnections({ tokenVersion }) {
  const toast = useToast();
  const confirm = useConfirm();
  const state = useApi(() => api('listMcpConnections'), [tokenVersion]);
  const [busyId, setBusyId] = useState('');
  const headId = useId();
  const revoke = async (c) => {
    const ok = await confirm({
      title: '이 연결 끊기',
      message: `${c.client_name} 연결(${stamp(c.created_at)} 허용)의 접근 권한이 무효가 됩니다. 다른 연결은 그대로입니다.`,
      confirmLabel: '끊기',
      danger: true
    });
    if (!ok) return;
    setBusyId(c.grant_id);
    try {
      await api('revokeMcpConnection', c.grant_id);
      toast('연결을 끊었습니다.');
      state.reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId('');
    }
  };
  return (
    <div className="field">
      <span id={headId} style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>연결된 커넥터</span>
      <div aria-labelledby={headId} role="group">
        <Async state={state}>
          {(list) => (list.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>이름</th><th>허용한 때</th><th>마지막 갱신</th><th aria-label="끊기" /></tr></thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.grant_id}>
                      <td>{c.client_name}</td>
                      <td>{stamp(c.created_at)}</td>
                      <td>{stamp(c.last_used_at)}</td>
                      <td className="num">
                        <button type="button" className="btn secondary sm" disabled={busyId === c.grant_id} onClick={() => revoke(c)}>
                          {busyId === c.grant_id ? '처리 중…' : '끊기'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="st-hint" style={{ margin: 0 }}>연결된 커넥터가 없습니다.</p>)}
        </Async>
      </div>
    </div>
  );
}

function McpConnectorCard({ form, set, changed, tokenVersion, onDisconnected }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setUrl(`${window.location.origin}/api/mcp`), []);
  const mode = mcpModeOf(form.mcp_write_mode);
  const copy = () => navigator.clipboard.writeText(url).then(() => toast('커넥터 URL을 복사했습니다.'), () => toast('복사하지 못했습니다.', 'error'));
  const disconnect = async () => {
    const ok = await confirm({
      title: 'Claude 연결 끊기',
      message: '지금까지 Claude에 발급된 접근 권한이 모두 무효가 됩니다. 다시 쓰려면 claude.ai에서 커넥터를 다시 연결해야 합니다.',
      confirmLabel: '연결 끊기',
      danger: true
    });
    if (!ok) return;
    setBusy(true);
    try {
      const current = Number(tokenVersion);
      const next = Number.isInteger(current) && current >= 0 ? current + 1 : 1;
      await api('saveSettings', { mcp_token_version: String(next) });
      toast('Claude 연결을 끊었습니다.');
      onDisconnected();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <SectionHead title="Claude 커넥터" changed={changed} />
      <p className="st-hint">claude.ai의 설정 → 커넥터 → 커스텀 커넥터 추가에 아래 URL을 넣고, 로그인해서 허용하면 연결됩니다.</p>
      <div className="stack-sm">
        <Field label="쓰기 권한" hint={mode.hint}>
          {(id) => (
            <select id={id} value={mode.value} onChange={set('mcp_write_mode')}>
              {MCP_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          )}
        </Field>
        <Field label="커넥터 URL">
          {(id) => (
            <div className="cluster">
              <input id={id} value={url} readOnly onFocus={(e) => e.target.select()} style={{ flex: '1 1 260px' }} />
              <button type="button" className="btn secondary" disabled={!url} onClick={copy}>복사</button>
            </div>
          )}
        </Field>
        <McpConnections tokenVersion={tokenVersion} />
        <div className="st-promote">
          <span className="st-hint" style={{ margin: 0, flex: '1 1 260px' }}>연결 끊기는 지금까지 발급된 Claude 접근 권한을 모두 무효로 만듭니다. 설정 저장과 별개로 바로 적용됩니다.</span>
          <button type="button" className="btn secondary" disabled={busy} onClick={disconnect}>{busy ? '처리 중…' : '연결 끊기…'}</button>
        </div>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const boot = useBoot();
  const toast = useToast();
  const [saved, setSaved] = useState(boot.settings || {});
  const [form, setForm] = useState(boot.settings || {});
  const [saving, setSaving] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  useEffect(() => {
    const next = boot.settings || {};
    const prev = savedRef.current;
    setForm((f) => {
      const kept = KEYS.filter((k) => value(f, k) !== value(prev, k)).map((k) => [k, f[k]]);
      return { ...next, ...Object.fromEntries(kept) };
    });
    setSaved(next);
  }, [boot.settings]);

  const changedKeys = new Set(KEYS.filter((k) => value(form, k) !== value(saved, k)));
  const changed = SECTIONS.filter((s) => s.keys.some((k) => changedKeys.has(k)));
  const isChanged = (id) => changed.some((s) => s.id === id);
  const dirty = changed.length > 0;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  useUnsavedGuard(dirty && !saving);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api('saveSettings', Object.fromEntries(KEYS.map((k) => [k, form[k] || ''])));
      setSaved(next);
      toast('설정을 저장했습니다.');
      boot.refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveRef = useRef(save);
  saveRef.current = () => { if (dirty && !saving && !document.querySelector('.modal')) save(); };
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const input = (key, label, props = {}) => (
    <Field key={key} label={label}>
      {(id) => <input id={id} value={value(form, key)} placeholder={PLACEHOLDERS[key] || ''} onChange={set(key)} {...props} />}
    </Field>
  );

  return (
    <div className="settings-page">
      <PageHeader title="설정" sub="보고서·PDF에 들어가는 정보" />
      <div className="stack">
        <section className="card">
          <SectionHead title="학원 정보" changed={isChanged('academy')} />
          <p className="st-hint">사이드바와 보고서·PDF에 들어갑니다.</p>
          <div className="st-academy">
            {input('academy_name', '학원명')}
            {input('teacher_name', '담당 강사명')}
            {input('contact', '연락처', { inputMode: 'tel' })}
          </div>
        </section>

        <section className="card">
          <SectionHead title="보고서 문구" changed={isChanged('report')} />
          <p className="st-hint">일일·월간 보고서의 처음과 끝에 들어갑니다.</p>
          <div className="st-report">
            <div className="st-report-fields">
              {input('report_greeting', '인사말')}
              <Field label="맺음말" hint="비우면 기본 문구가 들어갑니다.">
                {(id) => <textarea id={id} rows={3} value={value(form, 'report_closing')} placeholder={PLACEHOLDERS.report_closing} onChange={set('report_closing')} />}
              </Field>
            </div>
            <ReportPreview form={form} date={boot.today} />
          </div>
        </section>

        <section className="card">
          <SectionHead title="과제 이행 등급 기준" changed={isChanged('assignment')} />
          <HelpRow text="보고서에 등급과 함께 표시되는 설명입니다." label="등급 계산 방법">
            <p>항목 등급을 점수로 바꿔 평균을 냅니다: {GRADE_KEYS.map((g) => `${g} ${LMS.ASSIGNMENT_POINTS[g]}`).join(' · ')}</p>
            <p>평균이 A 90점 이상, B 80점 이상, C 70점 이상, D 60점 이상, E 51점 이상, 그 아래는 F입니다.</p>
          </HelpRow>
          <div className="st-grades">
            {GRADE_KEYS.map((g) => input(`assignment_${g}`, `${g} 기준`))}
          </div>
        </section>

        <McpConnectorCard form={form} set={set} changed={isChanged('mcp')}
          tokenVersion={saved.mcp_token_version} onDisconnected={() => boot.refresh()} />

        <section className="card st-promote">
          <div className="st-promote-text">
            <SectionHead title="새 학년도 준비">
              <span className="tag muted">저장과 별개 · 바로 적용</span>
            </SectionHead>
            <HelpRow text="재원생 학년을 한 단계씩 올립니다(중2 → 중3)." label="자세히">
              <p>3월에 한 번 쓰는 작업입니다. 창에서 학년별 인원을 확인한 뒤 적용하며, 설정 저장과 상관없이 바로 반영됩니다. 입력 중인 설정은 그대로 남습니다.</p>
            </HelpRow>
          </div>
          <button type="button" className="btn secondary" onClick={() => setPromoting(true)}>학년 올리기…</button>
        </section>

        <div className="save-bar">
          <span className={'save-state ' + (dirty ? 'dirty' : '')}>
            <span className="sb-long">{dirty ? `● 저장하지 않은 변경 ${changed.length}곳 (${changed.map((s) => s.title).join(' · ')})` : '저장됨'}</span>
            <span className="sb-short">{dirty ? `● 변경 ${changed.length}곳` : '저장됨'}</span>
          </span>
          <span className="cluster save-actions">
            <button type="button" className="btn secondary" disabled={!dirty || saving} onClick={() => setForm(saved)}>변경 취소</button>
            <button type="button" className="btn" disabled={!dirty || saving} onClick={save} title="설정 저장 (Ctrl+S)">{saving ? '저장 중…' : '설정 저장'}</button>
          </span>
        </div>
      </div>
      {promoting ? <PromotionModal onClose={() => setPromoting(false)} onDone={() => { setPromoting(false); boot.refresh(); }} /> : null}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import Modal from '@/components/ui/Modal';
import Field from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import CancelDayDialog from './CancelDayDialog';
import { api, useApi } from '@/lib/client-api';
import { generatePlanAi } from '@/lib/report-client';
import { formatDate, shortDate } from '@/lib/format';

const ACTION_LABEL = { add: '추가', change: '변경', remove: '삭제', same: '같음', locked: '잠금' };
const ACTION_TONE = { add: 'ok', change: 'amber', remove: 'danger', same: 'muted', locked: 'muted' };
const SOURCE_LABEL = { ai: 'AI', split: '기본 분할' };
const DONE_TONE = { 완료: 'ok', 일부: 'amber', '못 함': 'danger' };
const STATUS_LABEL = { cancelled: '휴강', suspended: '시험대비 휴강', none: '수업 없음', makeup: '보강' };

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month) {
  const [y, m] = month.split('-');
  return `${y}년 ${Number(m)}월`;
}

function itemLabel(it) {
  if (it.period_type === '월간') return '월간';
  if (it.period_type === '주간') return `${shortDate(it.period_key)} 주`;
  return shortDate(it.period_key);
}

function planText(p) {
  if (!p) return '';
  return p.title || p.objectives || p.content || '제목 없음';
}

/** Edit one month, week or day plan by hand. Saving makes it the teacher's own plan. */
function PlanForm({ classId, target, curriculum, onClose, onSaved }) {
  const toast = useToast();
  const plan = target.plan;
  const [form, setForm] = useState(() => ({
    title: '', objectives: '', content: '', materials: '', homework: '', memo: '', done_status: '',
    ...(plan || {}),
    unit_ids: plan ? plan.unit_ids || [] : []
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggleUnit = (id) => setForm((f) => ({ ...f, unit_ids: f.unit_ids.includes(id) ? f.unit_ids.filter((u) => u !== id) : [...f.unit_ids, id] }));
  const isDay = target.period_type === '일간';

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('saveClassPlan', {
        plan_id: plan ? plan.plan_id : '', class_id: classId, period_type: target.period_type, period_key: target.period_key,
        title: form.title, objectives: form.objectives, content: form.content, materials: form.materials,
        homework: form.homework, memo: form.memo, unit_ids: form.unit_ids,
        ...(isDay ? { done_status: form.done_status } : {})
      });
      toast('계획을 저장했습니다.');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('이 계획을 삭제할까요?')) return;
    try {
      await api('deleteClassPlan', plan.plan_id);
      toast('삭제했습니다.');
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  const heading = target.period_type === '월간' ? monthLabel(target.period_key) : target.period_type === '주간' ? `${shortDate(target.period_key)} 주` : formatDate(target.period_key);
  return (
    <Modal title={`${heading} ${target.period_type} 계획`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {plan && plan.source !== 'manual' ? <p className="hint" style={{ margin: 0 }}>{SOURCE_LABEL[plan.source]}로 만든 계획입니다. 저장하면 직접 쓴 계획이 되어, 다음 분할 때 기본으로 유지됩니다.</p> : null}
        <div className="form-grid">
          <Field label="제목" wide>{(id) => <input id={id} value={form.title} onChange={set('title')} placeholder="예: 삼각형의 닮음 조건" />}</Field>
          {curriculum.length ? (
            <Field label="단원" wide>{() => (
              <div className="chips" role="group" aria-label="단원">
                {curriculum.map((u) => (
                  <button key={u.unit_id} type="button" className="chip" aria-pressed={form.unit_ids.includes(u.unit_id)} onClick={() => toggleUnit(u.unit_id)}>{u.title}</button>
                ))}
              </div>
            )}</Field>
          ) : null}
          <Field label="학습 목표" wide>{(id) => <textarea id={id} rows={2} value={form.objectives} onChange={set('objectives')} />}</Field>
          <Field label="수업 내용" wide>{(id) => <textarea id={id} rows={3} value={form.content} onChange={set('content')} />}</Field>
          <Field label="준비물 · 자료">{(id) => <input id={id} value={form.materials} onChange={set('materials')} />}</Field>
          <Field label="예정 숙제">{(id) => <input id={id} value={form.homework} onChange={set('homework')} />}</Field>
          {isDay ? (
            <Field label="진행 결과">{(id) => (
              <select id={id} value={form.done_status} onChange={set('done_status')}>
                <option value="">아직 / 미기록</option><option>완료</option><option>일부</option><option>못 함</option>
              </select>
            )}</Field>
          ) : null}
          <Field label="메모" wide>{(id) => <textarea id={id} rows={2} value={form.memo} onChange={set('memo')} />}</Field>
        </div>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          {plan ? <button type="button" className="btn ghost" onClick={remove} style={{ marginRight: 'auto' }}>삭제</button> : null}
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </form>
    </Modal>
  );
}

function MovePlanDialog({ plan, onClose, onSaved }) {
  const toast = useToast();
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api('moveDailyPlan', { plan_id: plan.plan_id, to_date: date });
      toast(`${formatDate(date)}로 옮겼습니다.`);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal title="계획 옮기기" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}><strong>{planText(plan)}</strong> 계획을 다른 수업일(반 보강 포함)로 옮깁니다. 보강은 오늘 화면의 ‘보강 추가’에서 반 보강으로 먼저 잡아 주세요.</p>
        <Field label="옮길 날짜">{(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn">옮기기</button>
        </div>
      </form>
    </Modal>
  );
}

function UnitProgress({ units, currentId }) {
  if (!units.length) return null;
  return (
    <div className="unit-list">
      {units.map((u) => (
        <div key={u.unit_id} className={'unit-row' + (u.unit_id === currentId ? ' is-current' : '')}>
          <span className="unit-title">{u.title}{u.textbook ? <span className="muted"> · {u.textbook}</span> : null}</span>
          <span className="progress" aria-hidden="true"><span style={{ width: `${Math.min(100, (u.done / u.sessions) * 100)}%` }} /></span>
          <span className="muted unit-count">{u.complete ? '완료' : `${u.done}/${u.sessions}회`}{u.unit_id === currentId ? ' · 지금' : ''}</span>
        </div>
      ))}
    </div>
  );
}

function DraftReview({ board, onApply, onDiscard, busy }) {
  const draft = board.draft;
  const visible = useMemo(() => draft.items.filter((it) => it.action !== 'locked' && it.action !== 'same'), [draft]);
  const [picked, setPicked] = useState(() => new Set(draft.items.filter((it) => it.selected).map((it) => it.key)));
  useEffect(() => {
    setPicked(new Set(draft.items.filter((it) => it.selected).map((it) => it.key)));
  }, [draft]);
  const toggle = (key) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const counts = draft.items.reduce((m, it) => ({ ...m, [it.action]: (m[it.action] || 0) + 1 }), {});
  const selectable = visible.filter((it) => it.selectable);
  return (
    <section className="card draft-card" aria-label="계획 초안 검토">
      <div className="card-head">
        <h2>{draft.mode === 'ai' ? 'AI 제안 초안' : '기본 분할 초안'} 검토</h2>
        <span className="cluster">
          {['add', 'change', 'remove'].filter((a) => counts[a]).map((a) => <span key={a} className={'tag ' + ACTION_TONE[a]}>{ACTION_LABEL[a]} {counts[a]}</span>)}
          {counts.same ? <span className="tag muted">같음 {counts.same}</span> : null}
          {counts.locked ? <span className="tag muted">지난 수업 {counts.locked} 유지</span> : null}
        </span>
      </div>
      {draft.stale ? <div className="notice-bar" style={{ marginBottom: 12 }}>초안을 만든 뒤 계획이 바뀌었습니다. 아래 비교는 지금 계획 기준입니다.</div> : null}
      {draft.warnings.length ? (
        <ul className="muted" style={{ margin: '0 0 12px', paddingLeft: 18 }}>{draft.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      ) : null}
      {draft.rationale ? (
        <details style={{ marginBottom: 12 }}>
          <summary className="link-btn">AI가 이렇게 짠 이유</summary>
          <p className="prewrap" style={{ margin: '8px 0 0' }}>{draft.rationale}</p>
        </details>
      ) : null}
      {draft.carry_over.length ? <p className="muted" style={{ margin: '0 0 12px' }}>다음 달로 넘어가는 단원: {draft.carry_over.join(', ')}</p> : null}
      {visible.length ? (
        <ul className="diff-list">
          {visible.map((it) => (
            <li key={it.key}>
              <label className="check-label">
                <input type="checkbox" checked={picked.has(it.key)} disabled={!it.selectable} onChange={() => toggle(it.key)} />
                <span className="diff-when">{itemLabel(it)}</span>
              </label>
              <span className={'tag ' + ACTION_TONE[it.action]}>{ACTION_LABEL[it.action]}</span>
              <span className="diff-text">
                {it.action === 'remove' ? <><s>{planText(it.current)}</s> <span className="muted">· 이 날은 수업이 없습니다</span></> : (
                  <>
                    {it.current ? <span className="muted"><s>{planText(it.current)}</s>{it.current.source === 'manual' ? ' (직접 쓴 계획)' : ''} → </span> : null}
                    <strong>{planText(it.proposed)}</strong>
                    {it.proposed.content ? <span className="muted"> — {it.proposed.content}</span> : null}
                    {it.proposed.homework ? <span className="muted"> · 숙제: {it.proposed.homework}</span> : null}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : <EmptyState>바뀌는 계획이 없습니다.</EmptyState>}
      <div className="form-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn ghost" onClick={onDiscard} disabled={busy}>초안 버리기</button>
        {selectable.length ? <button type="button" className="btn secondary" onClick={() => setPicked(new Set(selectable.map((it) => it.key)))} disabled={busy}>모두 선택</button> : null}
        <button type="button" className="btn" disabled={busy || !picked.size} onClick={() => onApply([...picked])}>
          {busy ? '확정 중…' : `선택한 ${picked.size}개 확정`}
        </button>
      </div>
    </section>
  );
}

function Suggestions({ list, onDecide, busy }) {
  if (!list.length) return null;
  return (
    <section className="card" aria-label="학생별 제안">
      <div className="card-head"><h2>학생별 제안</h2><span className="muted">확정하면 할 일로 등록됩니다</span></div>
      <ul className="task-list">
        {list.map((s) => (
          <li key={s.suggestion_id} className={s.status !== '제안' ? 'is-done' : ''}>
            <span className="tag muted">{s.kind}</span>
            <span className="task-title"><strong>{s.student_name || s.student_id}</strong> · {s.title}{s.reason ? <span className="muted"> — {s.reason}</span> : null}</span>
            {s.status === '제안' ? (
              <span className="cluster">
                <button type="button" className="btn ok sm" disabled={busy} onClick={() => onDecide(s, '확정')}>확정</button>
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => onDecide(s, '무시')}>무시</button>
              </span>
            ) : <span className={'tag ' + (s.status === '확정' ? 'ok' : 'muted')}>{s.status === '확정' ? '할 일 등록' : '무시함'}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DayRow({ day, onEdit, onCancel, onRestore, onMove }) {
  const p = day.plan;
  const off = day.status === 'cancelled' || day.status === 'suspended' || day.status === 'none';
  return (
    <li className={'plan-day' + (off ? ' is-off' : '') + (day.locked ? ' is-past' : '')}>
      <div className="plan-day-when">
        <strong>{shortDate(day.date)}</strong>
        {STATUS_LABEL[day.status] ? <span className={'tag ' + (day.status === 'makeup' ? '' : 'muted')}>{STATUS_LABEL[day.status]}</span> : null}
      </div>
      <div className="plan-day-what">
        {day.status === 'cancelled' && day.cancel_reason ? <span className="muted">사유: {day.cancel_reason}</span> : null}
        {day.status === 'suspended' ? <span className="muted">{day.suspension_title}</span> : null}
        {p ? (
          <span>
            <span className={off ? 'muted' : ''}>{planText(p)}</span>
            {p.source !== 'manual' ? <span className="tag muted" style={{ marginLeft: 6 }}>{SOURCE_LABEL[p.source]}</span> : null}
            {p.done_status ? <span className={'tag ' + DONE_TONE[p.done_status]} style={{ marginLeft: 6 }}>{p.done_status}</span> : null}
            {p.homework ? <span className="muted"> · 숙제: {p.homework}</span> : null}
          </span>
        ) : !off ? <span className="muted">계획 없음</span> : null}
        {day.recorded ? <span className="muted">실제 진도: {day.progress || '기록됨'}</span> : null}
      </div>
      <div className="cluster plan-day-actions">
        {!off || p ? <button type="button" className="link-btn" onClick={() => onEdit(day)}>{p ? '수정' : '작성'}</button> : null}
        {(day.status === 'meets') && !day.recorded ? <button type="button" className="link-btn" onClick={() => onCancel(day)}>휴강</button> : null}
        {day.status === 'cancelled' ? <button type="button" className="link-btn" onClick={() => onRestore(day)}>휴강 취소</button> : null}
        {off && p && !day.recorded ? <button type="button" className="link-btn" onClick={() => onMove(p)}>옮기기</button> : null}
      </div>
    </li>
  );
}

export default function PlansTab({ classId }) {
  const boot = useBoot();
  const toast = useToast();
  const [month, setMonth] = useState(() => (boot.today || '').slice(0, 7));
  const [editing, setEditing] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [moving, setMoving] = useState(null);
  const [busy, setBusy] = useState('');
  const state = useApi(() => api('getPlanBoard', classId, month), [classId, month]);

  const run = async (label, job, done) => {
    setBusy(label);
    try {
      const board = await job();
      if (board && board.days) state.setData(board);
      else state.reload();
      if (done) toast(typeof done === 'function' ? done(board) : done);
    } catch (err) {
      toast(err.message, 'error');
      // A refused confirm means the plans moved under us: show the fresh comparison.
      state.reload();
    } finally {
      setBusy('');
    }
  };

  const split = (m) => run('split', () => api('createSplitDraft', classId, m || month), '기본 분할 초안을 만들었습니다. 비교해서 확정하세요.');
  const ai = () => run('ai', () => generatePlanAi(classId, month), 'AI 초안을 만들었습니다. 비교해서 확정하세요.');

  return (
    <div className="stack">
      <div className="split">
        <div className="cluster">
          <button type="button" className="btn secondary sm" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="이전 달">◀</button>
          <strong style={{ minWidth: 96, textAlign: 'center' }}>{monthLabel(month)}</strong>
          <button type="button" className="btn secondary sm" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="다음 달">▶</button>
        </div>
        {state.data ? (
          <div className="cluster">
            <button type="button" className="btn" disabled={!!busy || !state.data.support.ok || !boot.ai_enabled || !state.data.editable_count}
              title={!boot.ai_enabled ? 'AI_API_KEY가 설정되지 않았습니다' : ''} onClick={ai}>
              {busy === 'ai' ? 'AI가 계획을 짜는 중…' : 'AI로 계획 제안'}
            </button>
            <button type="button" className="btn secondary" disabled={!!busy || !state.data.support.ok || !state.data.editable_count} onClick={() => split()}>
              {busy === 'split' ? '나누는 중…' : '기본 분할 · 재조정'}
            </button>
          </div>
        ) : null}
      </div>
      <Async state={state}>
        {(b) => (
          <>
            {!b.support.ok ? <div className="notice-bar">{b.support.reason} 계획은 아래에서 직접 작성할 수 있습니다.</div> : null}
            {b.support.ok && !boot.ai_enabled ? <p className="hint" style={{ margin: 0 }}>AI 제안은 서버에 AI_API_KEY가 있어야 쓸 수 있습니다. 기본 분할은 언제든 쓸 수 있습니다.</p> : null}
            {b.warnings.length ? (
              <div className="notice-bar">
                {b.warnings.map((w) => <div key={w.code + (w.date || '')}>{w.message}</div>)}
              </div>
            ) : null}
            {b.draft ? (
              <DraftReview board={b} busy={busy === 'apply' || busy === 'discard'}
                onApply={(keys) => run('apply', () => api('applyPlanDraft', { draft_id: b.draft.draft_id, seen_version: b.base_version, keys }), (nb) => `${nb.applied_count}개 계획을 확정했습니다.`)}
                onDiscard={() => run('discard', () => api('discardPlanDraft', b.draft.draft_id), '초안을 버렸습니다.')} />
            ) : null}
            <Suggestions list={b.suggestions} busy={!!busy}
              onDecide={(s, decision) => run('suggest', () => api('decidePlanSuggestion', { suggestion_id: s.suggestion_id, decision }), decision === '확정' ? '할 일로 등록했습니다.' : '제안을 넘겼습니다.')} />

            <section className="card">
              <div className="card-head">
                <h2>{monthLabel(b.month)} 목표</h2>
                <button type="button" className="link-btn" onClick={() => setEditing({ period_type: '월간', period_key: b.month, plan: b.month_plan })}>{b.month_plan ? '수정' : '작성'}</button>
              </div>
              {b.month_plan ? (
                <div className="stack-sm">
                  <strong>{planText(b.month_plan)}{b.month_plan.source !== 'manual' ? <span className="tag muted" style={{ marginLeft: 6 }}>{SOURCE_LABEL[b.month_plan.source]}</span> : null}</strong>
                  {b.month_plan.objectives && b.month_plan.title ? <div className="prewrap muted">{b.month_plan.objectives}</div> : null}
                  {b.month_plan.rationale ? <details><summary className="link-btn">계획 근거</summary><p className="prewrap" style={{ margin: '8px 0 0' }}>{b.month_plan.rationale}</p></details> : null}
                </div>
              ) : <p className="muted" style={{ margin: 0 }}>이 달 계획이 아직 없습니다. {b.support.ok ? '위의 버튼으로 초안을 만들 수 있습니다.' : ''}</p>}
              {b.curriculum.length ? (
                <>
                  <h3 style={{ marginTop: 16 }}>단원 진행</h3>
                  <UnitProgress units={b.curriculum} currentId={b.current_unit_id} />
                  {b.carry_over.length ? <p className="hint" style={{ marginBottom: 0 }}>기본 분할로는 이 달에 다 못 나가는 단원: {b.carry_over.join(', ')}</p> : null}
                </>
              ) : null}
            </section>

            {b.weeks.map((w) => {
              const days = b.days.filter((d) => d.week_start === w.week_start);
              if (!days.length && !w.plan) return null;
              return (
                <section className="card plan-week" key={w.week_start}>
                  <div className="card-head">
                    <div>
                      <span className="tag muted">{shortDate(w.week_start)} ~ {shortDate(w.week_end)}</span>
                      <h3 style={{ marginTop: 6 }}>{w.plan ? planText(w.plan) : <span className="muted">주간 계획 없음</span>}
                        {w.plan && w.plan.source !== 'manual' ? <span className="tag muted" style={{ marginLeft: 6 }}>{SOURCE_LABEL[w.plan.source]}</span> : null}</h3>
                    </div>
                    <button type="button" className="link-btn" onClick={() => setEditing({ period_type: '주간', period_key: w.week_start, plan: w.plan })}>{w.plan ? '수정' : '작성'}</button>
                  </div>
                  {days.length ? (
                    <ul className="plan-days">
                      {days.map((d) => (
                        <DayRow key={d.date} day={d}
                          onEdit={(day) => setEditing({ period_type: '일간', period_key: day.date, plan: day.plan })}
                          onCancel={(day) => setCancelling(day)}
                          onRestore={(day) => run('restore', () => api('restoreClassDate', { class_id: classId, date: day.date }).then(() => api('getPlanBoard', classId, month)), '휴강을 취소했습니다.')}
                          onMove={(p) => setMoving(p)} />
                      ))}
                    </ul>
                  ) : <p className="muted" style={{ margin: 0 }}>이 주에는 이 달 수업일이 없습니다.</p>}
                </section>
              );
            })}

            {editing ? (
              <PlanForm classId={classId} target={editing} curriculum={b.curriculum}
                onClose={() => setEditing(null)} onSaved={() => { setEditing(null); state.reload(); }} />
            ) : null}
            {cancelling ? (
              <CancelDayDialog classId={classId} className={b.class.class_name} date={cancelling.date}
                onClose={() => setCancelling(null)} onDone={() => state.reload()} onReplan={(m) => split(m)} />
            ) : null}
            {moving ? <MovePlanDialog plan={moving} onClose={() => setMoving(null)} onSaved={() => { setMoving(null); state.reload(); }} /> : null}
          </>
        )}
      </Async>
    </div>
  );
}

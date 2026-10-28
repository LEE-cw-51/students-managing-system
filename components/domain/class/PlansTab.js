'use client';

import { useEffect, useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useDirty } from '@/components/ui/useDirty';
import Modal from '@/components/ui/Modal';
import Field from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import CancelDayDialog from './CancelDayDialog';
import { api, useApi } from '@/lib/client-api';
import { generatePlanAi } from '@/lib/report-client';
import { formatDate, shortDate } from '@/lib/format';
import { useConfirm } from '@/components/ui/ConfirmDialog';

const ACTION_LABEL = { add: '추가', change: '변경', remove: '삭제' };
const ACTION_TONE = { add: 'ok', change: 'amber', remove: 'danger' };
const SOURCE_LABEL = { ai: 'AI', split: '자동' };
const DONE_TONE = { 완료: 'ok', 일부: 'amber', '못 함': 'danger' };
const STATUS_LABEL = { cancelled: '휴강', suspended: '시험대비 휴강', none: '수업 없음', makeup: '보강' };
const SUGGESTION_KINDS = ['보충과제', '클리닉', '상담', '보강'];

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month) {
  const [y, m] = month.split('-');
  return `${y}년 ${Number(m)}월`;
}

function planText(p) {
  if (!p) return '';
  return p.title || p.objectives || p.content || '제목 없음';
}

/**
 * One form for a month goal or a day plan. With `draft` it edits the draft item (nothing is saved
 * to the plans until the teacher confirms); without it, it edits the confirmed plan directly.
 */
function PlanForm({ classId, target, curriculum, draft, onClose, onSaved }) {
  const confirm = useConfirm();
  const toast = useToast();
  const plan = target.plan;
  const [form, setForm] = useState(() => ({
    title: '', objectives: '', content: '', materials: '', homework: '', memo: '', done_status: '',
    ...(plan || {}),
    unit_ids: plan ? plan.unit_ids || [] : []
  }));
  const [error, setError] = useState('');
  const dirty = useDirty(form);
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggleUnit = (id) => setForm((f) => ({ ...f, unit_ids: f.unit_ids.includes(id) ? f.unit_ids.filter((u) => u !== id) : [...f.unit_ids, id] }));
  const isDay = target.period_type === '일간';
  const fields = { title: form.title, objectives: form.objectives, content: form.content, materials: form.materials, homework: form.homework, unit_ids: form.unit_ids };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (draft) {
        const board = await api('updatePlanDraftItem', { draft_id: draft.draft_id, key: `${target.period_type}|${target.period_key}`, fields });
        toast('초안을 고쳤습니다. 확정해야 반영됩니다.');
        onSaved(board);
      } else {
        await api('saveClassPlan', {
          ...fields, memo: form.memo, plan_id: plan ? plan.plan_id : '', class_id: classId,
          period_type: target.period_type, period_key: target.period_key,
          ...(isDay ? { done_status: form.done_status } : {})
        });
        toast('계획을 저장했습니다.');
        onSaved();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ message: '이 계획을 삭제할까요?', confirmLabel: '삭제', danger: true }))) return;
    try {
      await api('deleteClassPlan', plan.plan_id);
      toast('삭제했습니다.');
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  const heading = target.period_type === '월간' ? `${monthLabel(target.period_key)} 목표` : `${formatDate(target.period_key)} 수업 계획`;
  return (
    <Modal title={draft ? `${heading} (초안 고치기)` : heading} onClose={onClose} dirty={dirty}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="제목" wide>{(id) => <input id={id} value={form.title} onChange={set('title')} placeholder="예: 삼각형의 닮음 조건" />}</Field>
          {curriculum.length && isDay ? (
            <Field label="단원" wide>{() => (
              <div className="chips" role="group" aria-label="단원">
                {curriculum.map((u) => (
                  <button key={u.unit_id} type="button" className="chip" aria-pressed={form.unit_ids.includes(u.unit_id)} onClick={() => toggleUnit(u.unit_id)}>{u.title}</button>
                ))}
              </div>
            )}</Field>
          ) : null}
          <Field label={isDay ? '학습 목표' : '이 달 목표'} wide>{(id) => <textarea id={id} rows={2} value={form.objectives} onChange={set('objectives')} />}</Field>
          {isDay ? (
            <>
              <Field label="수업 내용" wide>{(id) => <textarea id={id} rows={3} value={form.content} onChange={set('content')} />}</Field>
              <Field label="준비물 · 자료">{(id) => <input id={id} value={form.materials} onChange={set('materials')} />}</Field>
              <Field label="예정 숙제">{(id) => <input id={id} value={form.homework} onChange={set('homework')} />}</Field>
            </>
          ) : null}
          {isDay && !draft ? (
            <Field label="진행 결과" hint="수업 기록에서도 고를 수 있습니다">{(id) => (
              <select id={id} value={form.done_status} onChange={set('done_status')}>
                <option value="">아직 / 미기록</option><option>완료</option><option>일부</option><option>못 함</option>
              </select>
            )}</Field>
          ) : null}
          {!draft ? <Field label="메모" wide>{(id) => <textarea id={id} rows={2} value={form.memo} onChange={set('memo')} />}</Field> : null}
        </div>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          {plan && plan.plan_id && !draft ? <button type="button" className="btn ghost" onClick={remove} style={{ marginRight: 'auto' }}>삭제</button> : null}
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : draft ? '초안에 반영' : '저장'}</button>
        </div>
      </form>
    </Modal>
  );
}

function SuggestionForm({ draft, item, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ kind: item.kind, title: item.title, reason: item.reason || '' });
  const [error, setError] = useState('');
  const dirty = useDirty(form);
  const submit = async (e) => {
    e.preventDefault();
    try {
      const board = await api('updatePlanDraftItem', { draft_id: draft.draft_id, key: item.key, fields: form });
      toast('제안을 고쳤습니다.');
      onSaved(board);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal title={`${item.student_name} 제안 고치기`} onClose={onClose} dirty={dirty}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="종류">{(id) => (
            <select id={id} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {SUGGESTION_KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
          )}</Field>
          <Field label="할 일" wide>{(id) => <input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
          <Field label="이유" wide>{(id) => <input id={id} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}</Field>
        </div>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn">초안에 반영</button>
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

/** The draft: every changed plan and every student suggestion in one list, each editable. */
function DraftReview({ board, busy, onEdit, onEditStudent, onApply, onDiscard }) {
  const draft = board.draft;
  const items = draft.items.filter((it) => ACTION_LABEL[it.action]);
  const initial = () => new Set([
    ...draft.items.filter((it) => it.selected).map((it) => it.key),
    ...draft.students.map((s) => s.key)
  ]);
  const [picked, setPicked] = useState(initial);
  // Only a new draft resets the choices; editing an item keeps them (and picks the edited one).
  useEffect(() => { setPicked(initial()); }, [draft.draft_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPicked((s) => {
      const next = new Set(s);
      draft.items.forEach((it) => { if (it.edited && it.selectable) next.add(it.key); });
      return next;
    });
  }, [draft]);
  const toggle = (key) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const lockedCount = draft.items.filter((it) => it.action === 'locked').length;

  return (
    <section className="card draft-card" aria-label="계획 초안">
      <div className="card-head">
        <h2>{draft.mode === 'ai' ? 'AI 초안' : '자동 초안'} — 고친 뒤 확정하세요</h2>
        {lockedCount ? <span className="muted">지난 수업 {lockedCount}회는 그대로 둡니다</span> : null}
      </div>
      {draft.stale ? <div className="notice-bar" style={{ marginBottom: 12 }}>초안을 만든 뒤 계획이 바뀌었습니다. 아래 비교는 지금 계획 기준입니다.</div> : null}
      {draft.warnings.length ? <ul className="muted" style={{ margin: '0 0 12px', paddingLeft: 18 }}>{draft.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
      {draft.rationale ? (
        <details style={{ marginBottom: 12 }}>
          <summary className="link-btn">AI가 이렇게 짠 이유</summary>
          <p className="prewrap" style={{ margin: '8px 0 0' }}>{draft.rationale}</p>
        </details>
      ) : null}
      {draft.carry_over.length ? <p className="muted" style={{ margin: '0 0 12px' }}>다음 달로 넘어가는 단원: {draft.carry_over.join(', ')}</p> : null}
      {items.length || draft.students.length ? (
        <ul className="diff-list">
          {items.map((it) => (
            <li key={it.key}>
              <label className="check-label">
                <input type="checkbox" checked={picked.has(it.key)} onChange={() => toggle(it.key)} />
                <span className="diff-when">{it.period_type === '월간' ? '이 달 목표' : shortDate(it.period_key)}</span>
              </label>
              <span className={'tag ' + ACTION_TONE[it.action]}>{ACTION_LABEL[it.action]}</span>
              <span className="diff-text">
                {it.action === 'remove' ? <><s>{planText(it.current)}</s> <span className="muted">· 이 날은 수업이 없습니다</span></> : (
                  <>
                    {it.current ? <span className="muted"><s>{planText(it.current)}</s> → </span> : null}
                    <strong>{planText(it.proposed)}</strong>
                    {it.edited ? <span className="tag" style={{ marginLeft: 6 }}>수정함</span> : null}
                    {it.proposed.content ? <span className="muted"> — {it.proposed.content}</span> : null}
                    {it.proposed.homework ? <span className="muted"> · 숙제: {it.proposed.homework}</span> : null}
                    {it.action === 'change' && it.current && it.current.source === 'manual' && !it.edited
                      ? <span className="hint" style={{ display: 'block' }}>직접 고친 계획이라 그대로 둡니다. 바꾸려면 체크하세요.</span> : null}
                  </>
                )}
              </span>
              {it.action !== 'remove' ? <button type="button" className="link-btn diff-edit" onClick={() => onEdit(it)}>고치기</button> : <span />}
            </li>
          ))}
          {draft.students.map((s) => (
            <li key={s.key}>
              <label className="check-label">
                <input type="checkbox" checked={picked.has(s.key)} onChange={() => toggle(s.key)} />
                <span className="diff-when">{s.student_name || '학생'}</span>
              </label>
              <span className="tag muted">{s.kind}</span>
              <span className="diff-text">
                <strong>{s.title}</strong>{s.edited ? <span className="tag" style={{ marginLeft: 6 }}>수정함</span> : null}
                {s.reason ? <span className="muted"> — {s.reason}</span> : null}
                <span className="hint" style={{ display: 'block' }}>확정하면 다음 수업일 할 일로 등록됩니다</span>
              </span>
              <button type="button" className="link-btn diff-edit" onClick={() => onEditStudent(s)}>고치기</button>
            </li>
          ))}
        </ul>
      ) : <EmptyState>지금 계획과 달라지는 것이 없습니다.</EmptyState>}
      <div className="form-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn ghost" onClick={onDiscard} disabled={!!busy}>초안 버리기</button>
        <button type="button" className="btn" disabled={!!busy || !picked.size} onClick={() => {
          const keys = [...picked];
          onApply(keys.filter((k) => !k.startsWith('student|')), keys.filter((k) => k.startsWith('student|')));
        }}>
          {busy === 'apply' ? '확정 중…' : `선택한 ${picked.size}개 최종 확정`}
        </button>
      </div>
    </section>
  );
}

function DayRow({ day, onEdit, onCancel, onRestore }) {
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
        {off && p && !day.recorded ? <span className="hint">초안을 다시 만들면 남은 수업일로 다시 나눕니다.</span> : null}
        {day.recorded ? <span className="muted">실제 진도: {day.progress || '기록됨'}</span> : null}
      </div>
      <div className="cluster plan-day-actions">
        {!off || p ? <button type="button" className="link-btn" onClick={() => onEdit(day)}>{p ? '수정' : '작성'}</button> : null}
        {day.status === 'meets' && !day.recorded ? <button type="button" className="link-btn" onClick={() => onCancel(day)}>휴강</button> : null}
        {day.status === 'cancelled' ? <button type="button" className="link-btn" onClick={() => onRestore(day)}>휴강 취소</button> : null}
      </div>
    </li>
  );
}

export default function PlansTab({ classId }) {
  const boot = useBoot();
  const toast = useToast();
  const [month, setMonth] = useState(() => (boot.today || '').slice(0, 7));
  const [editing, setEditing] = useState(null);
  const [editingStudent, setEditingStudent] = useState(null);
  const [cancelling, setCancelling] = useState(null);
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

  const makeDraft = (m) => run('draft', () => generatePlanAi(classId, m || month), (b) => (b.draft && b.draft.mode === 'ai'
    ? 'AI 초안을 만들었습니다. 고친 뒤 확정하세요.' : '단원 순서대로 초안을 만들었습니다. 고친 뒤 확정하세요.'));

  return (
    <div className="stack">
      <div className="split">
        <div className="cluster">
          <button type="button" className="btn secondary sm" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="이전 달">◀</button>
          <strong style={{ minWidth: 96, textAlign: 'center' }}>{monthLabel(month)}</strong>
          <button type="button" className="btn secondary sm" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="다음 달">▶</button>
        </div>
        {state.data ? (
          <button type="button" className="btn" disabled={!!busy || !state.data.support.ok || !state.data.editable_count} onClick={() => makeDraft()}>
            {busy === 'draft' ? (boot.ai_enabled ? 'AI가 초안을 짜는 중…' : '초안 만드는 중…') : state.data.draft ? '초안 다시 만들기' : '초안 만들기'}
          </button>
        ) : null}
      </div>
      <Async state={state}>
        {(b) => (
          <>
            {!b.support.ok ? <div className="notice-bar">{b.support.reason} 계획은 아래에서 직접 작성할 수 있습니다.</div> : null}
            {b.support.ok && !b.draft ? (
              <p className="hint" style={{ margin: 0 }}>
                {boot.ai_enabled ? 'AI가 진도·숙제·출석·시험 일정을 보고 남은 수업일 계획과 학생별 제안을 짭니다. 고친 뒤 확정하면 반영됩니다.'
                  : 'AI 키가 없어 단원 순서대로 남은 수업일에 나눕니다. 고친 뒤 확정하면 반영됩니다.'}
              </p>
            ) : null}
            {b.warnings.length ? <div className="notice-bar">{b.warnings.map((w) => <div key={w.code + (w.date || '')}>{w.message}</div>)}</div> : null}
            {b.draft ? (
              <DraftReview board={b} busy={busy}
                onEdit={(it) => setEditing({ period_type: it.period_type, period_key: it.period_key, plan: it.proposed, draft: b.draft })}
                onEditStudent={(s) => setEditingStudent(s)}
                onApply={(keys, studentKeys) => run('apply', () => api('applyPlanDraft', { draft_id: b.draft.draft_id, seen_version: b.base_version, keys, student_keys: studentKeys }),
                  (nb) => `계획 ${nb.applied_count}개${nb.task_count ? `, 할 일 ${nb.task_count}개` : ''}를 확정했습니다.`)}
                onDiscard={() => run('discard', () => api('discardPlanDraft', b.draft.draft_id), '초안을 버렸습니다.')} />
            ) : null}

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
              ) : <p className="muted" style={{ margin: 0 }}>이 달 계획이 아직 없습니다.</p>}
              {b.curriculum.length ? (
                <>
                  <h3 style={{ marginTop: 16 }}>단원 진행</h3>
                  <UnitProgress units={b.curriculum} currentId={b.current_unit_id} />
                </>
              ) : null}
            </section>

            {b.weeks.map((w) => {
              const days = b.days.filter((d) => d.week_start === w.week_start);
              if (!days.length) return null;
              return (
                <section className="card plan-week" key={w.week_start}>
                  <div className="card-head">
                    <div>
                      <span className="tag muted">{shortDate(w.week_start)} ~ {shortDate(w.week_end)}</span>
                      <h3 style={{ marginTop: 6 }}>{w.summary || w.note || <span className="muted">계획 없음</span>}</h3>
                      {w.note && w.summary ? <div className="muted">{w.note}</div> : null}
                    </div>
                  </div>
                  <ul className="plan-days">
                    {days.map((d) => (
                      <DayRow key={d.date} day={d}
                        onEdit={(day) => setEditing({ period_type: '일간', period_key: day.date, plan: day.plan })}
                        onCancel={(day) => setCancelling(day)}
                        onRestore={(day) => run('restore', () => api('restoreClassDate', { class_id: classId, date: day.date }).then(() => api('getPlanBoard', classId, month)), '휴강을 취소했습니다.')} />
                    ))}
                  </ul>
                </section>
              );
            })}

            {editing ? (
              <PlanForm classId={classId} target={editing} curriculum={b.curriculum} draft={editing.draft}
                onClose={() => setEditing(null)}
                onSaved={(board) => { setEditing(null); if (board && board.days) state.setData(board); else state.reload(); }} />
            ) : null}
            {editingStudent ? (
              <SuggestionForm draft={b.draft} item={editingStudent} onClose={() => setEditingStudent(null)}
                onSaved={(board) => { setEditingStudent(null); state.setData(board); }} />
            ) : null}
            {cancelling ? (
              <CancelDayDialog classId={classId} className={b.class.class_name} date={cancelling.date}
                onClose={() => setCancelling(null)} onDone={() => state.reload()} onReplan={(m) => makeDraft(m)} />
            ) : null}
          </>
        )}
      </Async>
    </div>
  );
}

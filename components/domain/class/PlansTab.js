'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useDirty } from '@/components/ui/useDirty';
import Modal, { ModalCancel } from '@/components/ui/Modal';
import Field from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import CancelDayDialog from './CancelDayDialog';
import { api, useApi } from '@/lib/client-api';
import { generatePlanAi } from '@/lib/report-client';
import { formatDate, shortDate } from '@/lib/format';

const ACTION_LABEL = { add: '추가', change: '변경', remove: '삭제' };
const ACTION_TONE = { add: 'ok', change: 'amber', remove: 'danger' };
const SOURCE_LABEL = { ai: 'AI', split: '자동' };
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

function planText(p) {
  if (!p) return '';
  return p.title || p.objectives || p.content || '제목 없음';
}

const UNDO_MS = 5000;

/**
 * Hides something right away and runs `job` after the undo window, even if the tab is left meanwhile.
 * `schedule` returns a cancel function; `after(stillMounted)` runs once the job went through.
 */
function useDelayed() {
  const toast = useToast();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return ({ message, doneMessage, failMessage, hide, unhide, job, after }) => {
    let cancelled = false;
    hide();
    toast(message, 'ok', { duration: UNDO_MS, action: { label: '되돌리기', onClick: () => { cancelled = true; unhide(); } } });
    setTimeout(async () => {
      if (cancelled) return;
      try {
        await job();
        toast(doneMessage);
        if (after) after(mounted.current);
      } catch (err) {
        if (mounted.current) unhide();
        toast(`${failMessage} ${err.message}`, 'error');
      }
    }, UNDO_MS);
    return () => { cancelled = true; };
  };
}

/**
 * One form for a month goal or a future day plan. With `draft` it edits the draft item (nothing is saved
 * to the plans until the teacher confirms); without it, it edits the confirmed plan directly.
 * Past days open read-only: what happened is recorded on the lesson record screen.
 */
function PlanForm({ classId, target, curriculum, draft, readOnly, onClose, onSaved, onDelete }) {
  const toast = useToast();
  const plan = target.plan;
  const [form, setForm] = useState(() => ({
    title: '', objectives: '', content: '', materials: '', homework: '', memo: '',
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
          period_type: target.period_type, period_key: target.period_key
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

  const heading = target.period_type === '월간' ? `${monthLabel(target.period_key)} 목표` : `${formatDate(target.period_key)} 수업 계획`;
  return (
    <Modal title={draft ? `${heading} (초안 고치기)` : readOnly ? `${heading} (지난 수업)` : heading} onClose={onClose} dirty={!readOnly && dirty}>
      <form className="stack" onSubmit={submit}>
        {readOnly ? <p className="hint" style={{ margin: 0 }}>지난 수업의 계획은 볼 수만 있습니다. 실제로 한 내용과 진행 결과는 수업 기록에서 고칩니다.</p> : null}
        <fieldset className="form-grid plan-fieldset" disabled={readOnly}>
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
          {!draft ? <Field label="메모" wide>{(id) => <textarea id={id} rows={2} value={form.memo} onChange={set('memo')} />}</Field> : null}
        </fieldset>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        {readOnly ? (
          <div className="form-actions"><ModalCancel>닫기</ModalCancel></div>
        ) : (
          <div className="form-actions">
            {plan && plan.plan_id && !draft ? <button type="button" className="btn ghost danger-text" onClick={() => onDelete(target)} style={{ marginRight: 'auto' }}>계획 삭제</button> : null}
            <ModalCancel />
            <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : draft ? '초안에 반영' : '저장'}</button>
          </div>
        )}
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

/** The draft: every changed plan in one list, each editable. */
function DraftReview({ board, busy, onEdit, onApply, onDiscard }) {
  const draft = board.draft;
  const items = draft.items.filter((it) => ACTION_LABEL[it.action]);
  const initial = () => new Set(draft.items.filter((it) => it.selected).map((it) => it.key));
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
      {items.length ? (
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
        </ul>
      ) : <EmptyState>지금 계획과 달라지는 것이 없습니다.</EmptyState>}
      <div className="form-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn ghost danger-text" style={{ marginRight: 'auto' }} onClick={onDiscard} disabled={!!busy}>초안 버리기</button>
        <button type="button" className="btn" disabled={!!busy || !picked.size} onClick={() => onApply([...picked])}>
          {busy === 'apply' ? '확정 중…' : `선택한 ${picked.size}개 최종 확정`}
        </button>
      </div>
    </section>
  );
}

function DayRow({ classId, day, log, today, onEdit, onCancel, onRestore }) {
  const p = day.plan;
  const off = day.status === 'cancelled' || day.status === 'suspended' || day.status === 'none';
  const past = day.date <= today;
  const recordable = past && (!off || day.recorded);
  const progress = (log && log.progress) || day.progress;
  const hasTest = log && (log.test_title || log.test_max_score || log.test_scope);
  return (
    <li className={'lesson-day' + (off ? ' is-off' : '') + (day.date < today ? ' is-past' : '')}>
      <div className="lesson-day-when">
        <strong>{shortDate(day.date)}</strong>
        {day.date === today ? <span className="tag">오늘</span> : null}
        {STATUS_LABEL[day.status] ? <span className={'tag ' + (day.status === 'makeup' ? '' : 'muted')}>{STATUS_LABEL[day.status]}</span> : null}
        {p && p.done_status ? <span className={'tag ' + DONE_TONE[p.done_status]}>{p.done_status}</span> : null}
        {p && p.source !== 'manual' ? <span className="tag muted">{SOURCE_LABEL[p.source]}</span> : null}
      </div>
      <div className="lesson-day-plan">
        <span className="lesson-day-label">계획</span>
        {day.status === 'cancelled' && day.cancel_reason ? <span className="muted">사유: {day.cancel_reason}</span> : null}
        {day.status === 'suspended' ? <span className="muted">{day.suspension_title}</span> : null}
        {p ? (
          <span>
            <span className={off ? 'muted' : ''}>{planText(p)}</span>
            {p.homework ? <span className="muted"> · 숙제: {p.homework}</span> : null}
          </span>
        ) : !off ? <span className="muted">계획 없음</span> : null}
        {off && p && !day.recorded ? <span className="hint">초안을 다시 만들면 남은 수업일로 다시 나눕니다.</span> : null}
      </div>
      <div className="lesson-day-actual">
        <span className="lesson-day-label">실제</span>
        {progress ? <span className="prewrap">{progress}{log && log.own_progress_count > 0 ? <span className="hint"> · 개인 진도 {log.own_progress_count}명</span> : null}</span>
          : recordable ? <span className="muted">진도 미입력</span> : <span className="muted">–</span>}
        {hasTest ? <span className="muted">테스트 {log.test_title || ''}{log.test_max_score ? ` ${log.test_max_score}점` : ''}{log.test_scope ? ` · 범위 ${log.test_scope}` : ''}</span> : null}
      </div>
      <div className="lesson-day-count">
        {log && log.recorded_count ? <span className={'tag ' + (log.recorded_count >= log.roster_count ? 'ok' : 'amber')}>{log.recorded_count}/{log.roster_count}명</span>
          : off ? null : past ? <span className="tag warn">미기록</span> : <span className="tag muted">예정</span>}
      </div>
      <div className="lesson-day-actions">
        {p || (!off && !day.recorded && day.date >= today) ? <button type="button" className="btn secondary sm" onClick={() => onEdit(day)} aria-label={`${shortDate(day.date)} 계획`}>계획</button> : null}
        {recordable ? <Link className={'btn sm' + (day.recorded ? ' secondary' : '')} href={`/today?class=${classId}&date=${day.date}`} aria-label={`${shortDate(day.date)} 수업 기록`}>기록 →</Link> : null}
        {day.status === 'meets' && !day.recorded ? <button type="button" className="btn ghost sm" onClick={() => onCancel(day)} aria-label={`${shortDate(day.date)} 휴강`}>휴강</button> : null}
        {day.status === 'cancelled' ? <button type="button" className="btn ghost sm" onClick={() => onRestore(day)}>휴강 취소</button> : null}
      </div>
    </li>
  );
}

function MonthGoal({ board, monthPlan, onEdit, onEditCurriculum }) {
  const [open, setOpen] = useState(false);
  const units = board.curriculum;
  const current = units.find((u) => u.unit_id === board.current_unit_id);
  const doneCount = units.filter((u) => u.complete).length;
  const unitLine = units.length
    ? `단원 진행 ${doneCount}/${units.length}${current ? ` (지금: ${current.title} ${current.done}/${current.sessions}회)` : ''}`
    : '단원 목록 없음';
  return (
    <section className="card lesson-goal">
      <div className="lesson-goal-line">
        <div className="lesson-goal-text">
          <strong>{monthLabel(board.month)} 목표</strong>
          {monthPlan ? (
            <span>{planText(monthPlan)}{monthPlan.source !== 'manual' ? <span className="tag muted" style={{ marginLeft: 6 }}>{SOURCE_LABEL[monthPlan.source]}</span> : null}</span>
          ) : <span className="muted">아직 없음</span>}
          <span className="muted">· {unitLine}</span>
        </div>
        <span className="cluster">
          <button type="button" className="btn ghost sm" aria-expanded={open} aria-controls="lesson-goal-more" onClick={() => setOpen((o) => !o)}>{open ? '단원 진행 ▴' : '단원 진행 ▾'}</button>
          <button type="button" className="btn secondary sm" onClick={onEdit}>{monthPlan ? '목표 수정' : '목표 작성'}</button>
        </span>
      </div>
      {open ? (
        <div className="stack-sm" id="lesson-goal-more" style={{ marginTop: 10 }}>
          {monthPlan && monthPlan.objectives && monthPlan.title ? <div className="prewrap muted">{monthPlan.objectives}</div> : null}
          {monthPlan && monthPlan.rationale ? <details><summary className="link-btn">계획 근거</summary><p className="prewrap" style={{ margin: '8px 0 0' }}>{monthPlan.rationale}</p></details> : null}
          {units.length ? <UnitProgress units={units} currentId={board.current_unit_id} /> : <span className="hint">단원을 순서대로 넣으면 초안을 실제 수업일에 맞춰 만들 수 있습니다.</span>}
          <div><button type="button" className="btn secondary sm" onClick={onEditCurriculum}>단원 목록 고치기</button></div>
        </div>
      ) : null}
    </section>
  );
}

function monthEnd(month) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

export default function PlansTab({ classId, version, onEditCurriculum }) {
  const boot = useBoot();
  const toast = useToast();
  const schedule = useDelayed();
  const [month, setMonth] = useState(() => (boot.today || '').slice(0, 7));
  const [editing, setEditing] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [busy, setBusy] = useState('');
  const [hiddenPlans, setHiddenPlans] = useState([]);
  const [hiddenDraft, setHiddenDraft] = useState('');
  const cancelDiscard = useRef(null);
  const state = useApi(() => api('getPlanBoard', classId, month), [classId, month, version]);
  const log = useApi(() => api('getClassProgressLog', classId, { start: `${month}-01`, end: monthEnd(month) }), [classId, month, version]);
  const logByDate = useMemo(() => Object.fromEntries(((log.data && log.data.rows) || []).map((r) => [r.date, r])), [log.data]);
  const showPlan = (p) => (p && !hiddenPlans.includes(p.plan_id) ? p : null);
  const draftOf = (b) => (b.draft && b.draft.draft_id !== hiddenDraft ? b.draft : null);

  const removePlan = (target) => {
    const p = target.plan;
    const label = target.period_type === '월간' ? `${monthLabel(target.period_key)} 목표` : `${shortDate(target.period_key)} 계획`;
    setEditing(null);
    schedule({
      message: `${label}을 ${UNDO_MS / 1000}초 뒤 삭제합니다.`,
      doneMessage: `${label}을 삭제했습니다.`,
      failMessage: `${label}을 삭제하지 못해 다시 표시했습니다.`,
      hide: () => setHiddenPlans((h) => [...h, p.plan_id]),
      unhide: () => setHiddenPlans((h) => h.filter((id) => id !== p.plan_id)),
      job: () => api('deleteClassPlan', p.plan_id),
      after: (stillMounted) => { if (stillMounted) state.reload(); }
    });
  };

  const discardDraft = (draft) => {
    cancelDiscard.current = schedule({
      message: `초안을 ${UNDO_MS / 1000}초 뒤 버립니다.`,
      doneMessage: '초안을 버렸습니다.',
      failMessage: '초안을 버리지 못해 다시 표시했습니다.',
      hide: () => setHiddenDraft(draft.draft_id),
      unhide: () => setHiddenDraft(''),
      job: () => api('discardPlanDraft', draft.draft_id),
      after: (stillMounted) => { cancelDiscard.current = null; if (stillMounted) state.reload(); }
    });
  };

  const run = async (label, job, done) => {
    setBusy(label);
    try {
      const board = await job();
      if (board && board.days) state.setData(board);
      else state.reload();
      log.reload();
      if (done) toast(typeof done === 'function' ? done(board) : done);
    } catch (err) {
      toast(err.message, 'error');
      // A refused confirm means the plans moved under us: show the fresh comparison.
      state.reload();
    } finally {
      setBusy('');
    }
  };

  const makeDraft = (m) => {
    if (cancelDiscard.current) {
      cancelDiscard.current();
      cancelDiscard.current = null;
      setHiddenDraft('');
    }
    run('draft', () => generatePlanAi(classId, m || month), (b) => (b.draft && b.draft.mode === 'ai'
      ? 'AI 초안을 만들었습니다. 고친 뒤 확정하세요.' : '단원 순서대로 초안을 만들었습니다. 고친 뒤 확정하세요.'));
  };

  const thisMonth = (boot.today || '').slice(0, 7);
  return (
    <div className="stack">
      <div className="split lesson-toolbar">
        <div className="cluster">
          <button type="button" className="btn secondary sm" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="이전 달">◀</button>
          <strong style={{ minWidth: 96, textAlign: 'center' }} aria-live="polite">{monthLabel(month)}</strong>
          <button type="button" className="btn secondary sm" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="다음 달">▶</button>
          {month !== thisMonth ? <button type="button" className="btn ghost sm" onClick={() => setMonth(thisMonth)}>이번 달</button> : null}
        </div>
        {state.data ? (
          <button type="button" className="btn" disabled={!!busy || !state.data.support.ok || !state.data.editable_count} onClick={() => makeDraft()}
            title={boot.ai_enabled ? 'AI가 진도·숙제·출석·시험 일정을 보고 남은 수업일 계획과 학생별 제안을 짭니다' : 'AI 키가 없어 단원 순서대로 남은 수업일에 나눕니다'}>
            {busy === 'draft' ? (boot.ai_enabled ? 'AI가 초안을 짜는 중…' : '초안 만드는 중…') : draftOf(state.data) ? '초안 다시 만들기' : boot.ai_enabled ? 'AI 초안 만들기' : '초안 만들기'}
          </button>
        ) : null}
      </div>
      <Async state={state}>
        {(b) => {
          const draft = draftOf(b);
          const monthPlan = showPlan(b.month_plan);
          return (
            <>
              {!b.support.ok ? <div className="notice-bar">{b.support.reason} 계획은 아래에서 직접 작성할 수 있습니다.</div> : null}
              {b.warnings.length ? <div className="notice-bar">{b.warnings.map((w) => <div key={w.code + (w.date || '')}>{w.message}</div>)}</div> : null}
              {draft ? (
                <DraftReview board={b} busy={busy}
                  onEdit={(it) => setEditing({ period_type: it.period_type, period_key: it.period_key, plan: it.proposed, draft })}
                  onApply={(keys) => run('apply', () => api('applyPlanDraft', { draft_id: draft.draft_id, seen_version: b.base_version, keys }),
                    (nb) => `계획 ${nb.applied_count}개를 확정했습니다.`)}
                  onDiscard={() => discardDraft(draft)} />
              ) : null}

              <MonthGoal board={b} monthPlan={monthPlan} onEditCurriculum={onEditCurriculum}
                onEdit={() => setEditing({ period_type: '월간', period_key: b.month, plan: monthPlan })} />

              {b.weeks.map((w) => {
                const days = b.days.filter((d) => d.week_start === w.week_start);
                if (!days.length) return null;
                return (
                  <section className="card lesson-week" key={w.week_start} aria-label={`${shortDate(w.week_start)} ~ ${shortDate(w.week_end)}`}>
                    <div className="lesson-week-head">
                      <strong>{shortDate(w.week_start)} ~ {shortDate(w.week_end)}</strong>
                      {w.summary || w.note ? <span className="muted"> · {w.summary || w.note}</span> : null}
                      {w.note && w.summary ? <span className="muted"> · {w.note}</span> : null}
                    </div>
                    <ul className="lesson-days">
                      {days.map((d) => {
                        const day = { ...d, plan: showPlan(d.plan) };
                        return (
                          <DayRow key={d.date} classId={classId} day={day} log={logByDate[d.date]} today={b.today}
                            onEdit={(x) => setEditing({ period_type: '일간', period_key: x.date, plan: x.plan, readOnly: x.date < b.today || x.recorded })}
                            onCancel={(x) => setCancelling(x)}
                            onRestore={(x) => run('restore', () => api('restoreClassDate', { class_id: classId, date: x.date }).then(() => api('getPlanBoard', classId, month)), '휴강을 취소했습니다.')} />
                        );
                      })}
                    </ul>
                  </section>
                );
              })}

              {editing ? (
                <PlanForm classId={classId} target={editing} curriculum={b.curriculum} draft={editing.draft} readOnly={!editing.draft && editing.readOnly}
                  onClose={() => setEditing(null)} onDelete={removePlan}
                  onSaved={(board) => { setEditing(null); if (board && board.days) state.setData(board); else state.reload(); }} />
              ) : null}
              {cancelling ? (
                <CancelDayDialog classId={classId} className={b.class.class_name} date={cancelling.date}
                  onClose={() => setCancelling(null)} onDone={() => { state.reload(); log.reload(); }} onReplan={(m) => makeDraft(m)} />
              ) : null}
            </>
          );
        }}
      </Async>
    </div>
  );
}

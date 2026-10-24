'use client';

import { useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import Modal from '@/components/ui/Modal';
import Field from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';
import { formatDate, shortDate } from '@/lib/format';

const PERIODS = ['일간', '주간', '월간'];

function periodLabel(plan) {
  if (plan.period_type === '월간') {
    const [y, m] = plan.period_key.split('-');
    return `${y}년 ${Number(m)}월`;
  }
  if (plan.period_type === '주간') return `${shortDate(plan.period_key)} 주`;
  return formatDate(plan.period_key);
}

function PlanForm({ classId, periodType, plan, onClose, onSaved }) {
  const { today } = useBoot();
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    period_type: plan ? plan.period_type : periodType,
    period_key: plan ? plan.period_key : (periodType === '월간' ? today.slice(0, 7) : today),
    title: '', objectives: '', content: '', materials: '', homework: '', memo: '',
    ...(plan || {})
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('saveClassPlan', { ...form, class_id: classId });
      toast('강의 계획을 저장했습니다.');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const keyLabel = form.period_type === '월간' ? '월' : form.period_type === '주간' ? '주 (아무 날짜나 고르면 그 주 월요일로 저장)' : '날짜';
  return (
    <Modal title={plan ? '강의 계획 수정' : '강의 계획 작성'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="기간 종류">{(id) => (
            <select id={id} value={form.period_type} disabled={!!plan}
              onChange={(e) => setForm((f) => ({ ...f, period_type: e.target.value, period_key: e.target.value === '월간' ? today.slice(0, 7) : today }))}>
              {PERIODS.map((p) => <option key={p}>{p}</option>)}
            </select>
          )}</Field>
          <Field label={keyLabel}>{(id) => (
            <input id={id} type={form.period_type === '월간' ? 'month' : 'date'} value={form.period_key} onChange={set('period_key')} disabled={!!plan} />
          )}</Field>
          <Field label="제목" wide>{(id) => <input id={id} value={form.title} onChange={set('title')} placeholder="예: 삼각형의 닮음 조건" />}</Field>
          <Field label="학습 목표" wide>{(id) => <textarea id={id} rows={2} value={form.objectives} onChange={set('objectives')} />}</Field>
          <Field label="수업 내용" wide>{(id) => <textarea id={id} rows={4} value={form.content} onChange={set('content')} />}</Field>
          <Field label="준비물 · 자료">{(id) => <input id={id} value={form.materials} onChange={set('materials')} />}</Field>
          <Field label="예정 숙제">{(id) => <input id={id} value={form.homework} onChange={set('homework')} />}</Field>
          <Field label="메모" wide>{(id) => <textarea id={id} rows={2} value={form.memo} onChange={set('memo')} />}</Field>
        </div>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function PlansTab({ classId }) {
  const toast = useToast();
  const [period, setPeriod] = useState('주간');
  const [editing, setEditing] = useState(null);
  const state = useApi(() => api('getClassPlans', { class_id: classId, period_type: period }), [classId, period]);

  const remove = async (plan) => {
    if (!window.confirm(`${periodLabel(plan)} 계획을 삭제할까요?`)) return;
    try {
      await api('deleteClassPlan', plan.plan_id);
      toast('삭제했습니다.');
      state.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="stack">
      <div className="split">
        <div className="segmented" role="group" aria-label="계획 기간">
          {PERIODS.map((p) => <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>{p}</button>)}
        </div>
        <button type="button" className="btn" onClick={() => setEditing({})}>{period} 계획 작성</button>
      </div>
      <Async state={state}>
        {(plans) => plans.length ? (
          <div className="stack-sm">
            {plans.map((p) => (
              <article className="card" key={p.plan_id}>
                <div className="card-head">
                  <div>
                    <span className="tag muted">{periodLabel(p)}</span>
                    <h3 style={{ marginTop: 6 }}>{p.title || p.objectives || '제목 없음'}</h3>
                  </div>
                  <div className="cluster">
                    <button type="button" className="btn secondary sm" onClick={() => setEditing({ plan: p })}>수정</button>
                    <button type="button" className="btn ghost sm" onClick={() => remove(p)}>삭제</button>
                  </div>
                </div>
                <dl className="dl">
                  {p.objectives && p.title ? <><dt>목표</dt><dd className="prewrap">{p.objectives}</dd></> : null}
                  {p.content ? <><dt>내용</dt><dd className="prewrap">{p.content}</dd></> : null}
                  {p.materials ? <><dt>자료</dt><dd>{p.materials}</dd></> : null}
                  {p.homework ? <><dt>숙제</dt><dd>{p.homework}</dd></> : null}
                  {p.memo ? <><dt>메모</dt><dd className="prewrap">{p.memo}</dd></> : null}
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <div className="card">
            <EmptyState title={`${period} 계획이 없습니다`} action={<button type="button" className="btn" onClick={() => setEditing({})}>{period} 계획 작성</button>}>
              일간 계획은 진도 기록 탭에서 실제 진도와 나란히 보입니다.
            </EmptyState>
          </div>
        )}
      </Async>
      {editing ? (
        <PlanForm classId={classId} periodType={period} plan={editing.plan}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); state.reload(); }} />
      ) : null}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Field from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api } from '@/lib/client-api';
import { shortDate } from '@/lib/format';

function ReturnModal({ member, period, onClose, onDone }) {
  const { today } = useBoot();
  const toast = useToast();
  const [date, setDate] = useState(today < member.start_date ? member.start_date : today > member.end_date ? member.end_date : today);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api('endTempAssignment', member.rel_id, date);
      toast(`${member.name} 학생은 ${shortDate(date)}까지 시험대비 수업 후 원래 반으로 돌아갑니다.`);
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal title={`${member.name} 복귀일 변경`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="시험대비 반 마지막 수업일" hint={`다음 날부터 ${member.source_class_name || '원래 반'} 명단으로 돌아갑니다. 시험이 끝난 학생부터 바로 원래 반 수업에 들어갑니다.`}>
          {(id) => <input id={id} type="date" min={member.start_date} max={period.end_date} value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn">저장</button>
        </div>
      </form>
    </Modal>
  );
}

function AddModal({ cls, period, onClose, onDone }) {
  const boot = useBoot();
  const toast = useToast();
  const [sid, setSid] = useState('');
  const [start, setStart] = useState(period.start_date);
  const [end, setEnd] = useState(period.end_date);
  const [error, setError] = useState('');
  const students = (boot.search.students || []).filter((s) => s.status === '재원' && !cls.students.some((m) => m.student_id === s.id));
  const submit = async (e) => {
    e.preventDefault();
    if (!sid) return setError('학생을 선택해 주세요.');
    try {
      await api('addTempAssignment', { class_id: cls.class_id, student_id: sid, start_date: start, end_date: end });
      toast('학생을 추가했습니다.');
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal title={`${cls.class_name}에 학생 추가`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="학생">{(id) => (
          <select id={id} value={sid} onChange={(e) => setSid(e.target.value)}>
            <option value="">선택</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.grade} {s.school}</option>)}
          </select>
        )}</Field>
        <div className="form-grid">
          <Field label="시작일">{(id) => <input id={id} type="date" min={period.start_date} max={period.end_date} value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label="마지막 수업일">{(id) => <input id={id} type="date" min={period.start_date} max={period.end_date} value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
        </div>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn">추가</button>
        </div>
      </form>
    </Modal>
  );
}

function SuspendModal({ detail, onClose, onDone }) {
  const boot = useBoot();
  const toast = useToast();
  const regular = (boot.search.classes || []).filter((c) => c.status === '운영' && c.class_type !== '시험대비');
  const [ids, setIds] = useState(() => new Set(detail.suspended.map((s) => s.class_id)));
  const toggle = (id) => setIds((set) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async () => {
    try {
      await api('setPeriodSuspendedClasses', detail.period.exam_period_id, Array.from(ids));
      toast('휴강 반을 저장했습니다.');
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <Modal title="휴강할 원래 반" onClose={onClose} footer={<><button type="button" className="btn secondary" onClick={onClose}>취소</button><button type="button" className="btn" onClick={save}>저장</button></>}>
      <div className="roster-chips">
        {regular.map((c) => (
          <button key={c.id} type="button" className={'tag ' + (ids.has(c.id) ? 'amber' : 'muted')} style={{ padding: '6px 10px' }} aria-pressed={ids.has(c.id)} onClick={() => toggle(c.id)}>
            {ids.has(c.id) ? '✓ ' : ''}{c.name}
          </button>
        ))}
      </div>
    </Modal>
  );
}

const STATE_TAG = { 예정: 'muted', '수업 중': 'ok', 복귀: '' };

export default function PeriodOperation({ detail, onChanged }) {
  const toast = useToast();
  const [returning, setReturning] = useState(null);
  const [adding, setAdding] = useState(null);
  const [editSuspend, setEditSuspend] = useState(false);
  const period = detail.period;
  const done = () => { setReturning(null); setAdding(null); setEditSuspend(false); onChanged(); };

  const remove = async (m) => {
    if (!window.confirm(`${m.name} 학생을 이 시험대비 반에서 뺄까요?`)) return;
    try {
      await api('removeTempAssignment', m.rel_id);
      toast('뺐습니다.');
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="stack">
      {detail.unplaced_count ? (
        <div className="notice-bar">휴강하는 반 학생 중 {detail.unplaced_count}명은 시험대비 반이 없어 기간 동안 수업이 없습니다. 아래 ‘휴강 반’에서 확인하세요.</div>
      ) : null}
      {detail.classes.map((c) => (
        <section key={c.class_id} className="card">
          <div className="card-head">
            <div>
              <h2 style={{ marginBottom: 2 }}><Link href={`/classes/${c.class_id}`}>{c.class_name}</Link>{c.status !== '운영' ? <span className="tag muted" style={{ marginLeft: 6 }}>{c.status}</span> : null}</h2>
              <span className="muted">{c.schedule_label} · 수업 {c.lesson_days}회</span>
            </div>
            <span className="cluster">
              <Link className="btn secondary sm" href={`/today?class=${c.class_id}`}>수업 기록</Link>
              <button type="button" className="btn secondary sm" onClick={() => setAdding(c)}>학생 추가</button>
            </span>
          </div>
          {c.students.length ? (
            <div className="table-wrap">
              <table className="data-table stack-mobile">
                <thead><tr><th>학생</th><th>원래 반</th><th>기간</th><th>상태</th><th /></tr></thead>
                <tbody>
                  {c.students.map((m) => (
                    <tr key={m.rel_id}>
                      <td className="primary"><Link href={`/students/${m.student_id}`}>{m.name}</Link></td>
                      <td data-label="원래 반">{m.source_class_name || '-'}</td>
                      <td data-label="기간">{shortDate(m.start_date)} ~ {shortDate(m.end_date)}</td>
                      <td data-label="상태"><span className={'tag ' + (STATE_TAG[m.state] || '')}>{m.state === '복귀' ? '원래 반 복귀' : m.state}</span></td>
                      <td>
                        <span className="cluster">
                          <button type="button" className="btn secondary sm" onClick={() => setReturning(m)}>복귀일 변경</button>
                          {!m.has_lessons ? <button type="button" className="btn ghost sm" onClick={() => remove(m)}>빼기</button> : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState>학생이 없습니다.</EmptyState>}
        </section>
      ))}
      <section className="card">
        <div className="card-head"><h2>휴강 반</h2><button type="button" className="btn secondary sm" onClick={() => setEditSuspend(true)}>휴강 반 변경</button></div>
        {detail.suspended.length ? (
          <div className="table-wrap">
            <table className="data-table stack-mobile">
              <thead><tr><th>반</th><th>전원 휴강</th><th>복귀 일정 (돌아온 학생부터 수업)</th><th>시험대비 반 없는 학생</th></tr></thead>
              <tbody>
                {detail.suspended.map((s) => (
                  <tr key={s.class_id}>
                    <td className="primary"><Link href={`/classes/${s.class_id}`}>{s.class_name}</Link></td>
                    <td data-label="전원 휴강">{shortDate(period.start_date)} ~ {shortDate(s.last_suspended)}</td>
                    <td data-label="복귀 일정">
                      <div className="stack-sm">
                        {s.returns.length ? s.returns.map((r) => (
                          <div key={r.date}><span className="tag ok">{shortDate(r.date)}</span> {r.names.join(', ')}</div>
                        )) : <span className="muted">-</span>}
                      </div>
                    </td>
                    <td data-label="미편성">{s.unplaced.length ? s.unplaced.map((u) => <Link key={u.student_id} href={`/students/${u.student_id}`} style={{ marginRight: 6 }}>{u.name}</Link>) : <span className="muted">없음</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>휴강하는 반이 없습니다. 원래 반은 평소대로 수업하고, 옮겨 간 학생만 그 반 명단에서 빠집니다.</EmptyState>}
      </section>
      {returning ? <ReturnModal member={returning} period={period} onClose={() => setReturning(null)} onDone={done} /> : null}
      {adding ? <AddModal cls={adding} period={period} onClose={() => setAdding(null)} onDone={done} /> : null}
      {editSuspend ? <SuspendModal detail={detail} onClose={() => setEditSuspend(false)} onDone={done} /> : null}
    </div>
  );
}

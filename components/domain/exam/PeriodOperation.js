'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import Modal, { ModalCancel } from '@/components/ui/Modal';
import Field from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { SelectAllCheckbox, useSelection } from '@/components/ui/useSelection';
import { useBoot } from '@/components/shell/AppShell';
import ScrollRow from '@/components/domain/exam/ScrollRow';
import { api } from '@/lib/client-api';
import { shortDate } from '@/lib/format';

const UNDO_MS = 5000;

function ReturnModal({ member, period, onClose, onDone }) {
  const { today } = useBoot();
  const toast = useToast();
  const [date, setDate] = useState(today < member.start_date ? member.start_date : today > member.end_date ? member.end_date : today);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api('endTempAssignment', member.rel_id, date);
      toast(member.source_class_id ? `${member.name} 학생은 ${shortDate(date)}까지 시험대비 수업 후 원래 반으로 돌아갑니다.` : `${member.name} 학생은 ${shortDate(date)}까지 시험대비 수업을 듣습니다.`);
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal title={`${member.name} 복귀일 변경`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="시험대비 반 마지막 수업일" hint={member.source_class_id ? `다음 날부터 ${member.source_class_name || '원래 반'} 명단으로 돌아갑니다. 시험이 끝난 학생부터 바로 원래 반 수업에 들어갑니다.` : '다음 날부터 시험대비 수업이 끝납니다. 원래 반이 없는 학생입니다.'}>
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
  const [filter, setFilter] = useState('');
  const [start, setStart] = useState(period.start_date);
  const [end, setEnd] = useState(period.end_date);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const students = (boot.search.students || []).filter((s) => s.status === '재원' && !cls.students.some((m) => m.student_id === s.id));
  const visible = students.filter((s) => !filter || s.name.includes(filter) || (s.school || '').includes(filter));
  const sel = useSelection(visible.map((s) => s.id));
  const picked = students.filter((s) => sel.selected.has(s.id));
  const submit = async (e) => {
    e.preventDefault();
    if (!picked.length) return setError('학생을 선택해 주세요.');
    setSaving(true);
    setError('');
    try {
      const res = await api('addTempAssignments', { class_id: cls.class_id, student_ids: picked.map((s) => s.id), start_date: start, end_date: end });
      toast(`${res.count}명을 추가했습니다.`);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={`${cls.class_name}에 학생 추가`} onClose={onClose} className="po-add-modal"
      footer={(
        <>
          <div className="po-add-dates">
            <Field label="시작일">{(id) => <input id={id} type="date" min={period.start_date} max={period.end_date} value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
            <Field label="마지막 수업일">{(id) => <input id={id} type="date" min={period.start_date} max={period.end_date} value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
          </div>
          {picked.length > 1 ? <p className="hint" style={{ margin: 0 }}>고른 학생 모두에게 같은 기간을 적용합니다.</p> : null}
          {error ? <div className="error-box prewrap" role="alert">{error}</div> : null}
          <div className="po-add-buttons">
            <span className="save-state">{picked.length}명 선택됨</span>
            <span className="cluster">
              <ModalCancel />
              <button type="submit" form="po-add-form" className="btn" disabled={saving}>{saving ? '추가 중…' : picked.length > 1 ? `${picked.length}명 추가` : '추가'}</button>
            </span>
          </div>
        </>
      )}>
      <form id="po-add-form" className="stack" onSubmit={submit}>
        <Field label="학생 찾기">{(id) => <input id={id} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="이름 또는 학교" />}</Field>
        <label className="check-label"><SelectAllCheckbox sel={sel} label="검색 결과 전체 선택" /> 검색 결과 전체 선택</label>
        <div className="table-wrap">
          <table className="data-table po-add-list">
            <tbody>
              {visible.length ? visible.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => sel.toggle(s.id)} aria-selected={sel.selected.has(s.id)}>
                  <td className="check-col"><input type="checkbox" checked={sel.selected.has(s.id)} onChange={() => sel.toggle(s.id)} onClick={(e) => e.stopPropagation()} aria-label={`${s.name} 선택`} /></td>
                  <td>
                    <strong>{s.name}</strong> <span className="muted">{s.grade} · {s.school || '학교 미입력'}</span>
                    <div>{(s.classes || []).length ? <span className="muted">{s.classes.join(', ')}</span> : <span className="tag warn">미배정</span>}</div>
                  </td>
                </tr>
              )) : <tr><td className="muted">{students.length ? '검색 결과가 없습니다.' : '추가할 수 있는 재원생이 없습니다.'}</td></tr>}
            </tbody>
          </table>
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

function StateTag({ m }) {
  return <span className={'tag ' + (STATE_TAG[m.state] || '')}>{m.state === '복귀' ? '원래 반 복귀' : m.state}</span>;
}

/** Hides the member right away and removes the assignment once the undo window closes. */
function useDelayedRemove(onRemoved) {
  const toast = useToast();
  const [pending, setPending] = useState([]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const remove = (m) => {
    let undone = false;
    const unhide = () => setPending((list) => list.filter((id) => id !== m.rel_id));
    setPending((list) => (list.includes(m.rel_id) ? list : [...list, m.rel_id]));
    toast(`${m.name} 학생을 ${UNDO_MS / 1000}초 뒤 이 반에서 뺍니다.`, 'ok', {
      duration: UNDO_MS,
      action: { label: '되돌리기', onClick: () => { undone = true; unhide(); } }
    });
    setTimeout(async () => {
      if (undone) return;
      try {
        await api('removeTempAssignment', m.rel_id);
        toast(`${m.name} 학생을 뺐습니다.`);
        if (mounted.current) onRemoved();
      } catch (err) {
        if (mounted.current) unhide();
        toast(`${m.name} 학생을 빼지 못해 다시 표시했습니다. ${err.message}`, 'error');
      }
    }, UNDO_MS);
  };
  return { pending, remove };
}

export default function PeriodOperation({ detail, onChanged }) {
  const [returning, setReturning] = useState(null);
  const [adding, setAdding] = useState(null);
  const [editSuspend, setEditSuspend] = useState(false);
  const { pending, remove } = useDelayedRemove(onChanged);
  const period = detail.period;
  const done = () => { setReturning(null); setAdding(null); setEditSuspend(false); onChanged(); };
  const jump = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const showJump = detail.classes.length + (detail.suspended.length ? 1 : 0) > 1;

  return (
    <div className="stack period-op">
      {detail.unplaced_count ? (
        <div className="notice-bar po-unplaced">
          <span>휴강하는 반 학생 중 {detail.unplaced_count}명은 시험대비 반이 없어 기간 동안 수업이 없습니다.</span>
          <button type="button" className="link-btn" onClick={() => jump('po-suspended')}>휴강 반 보기 ↓</button>
        </div>
      ) : null}
      {showJump ? (
        <ScrollRow className="po-jump" label="반 바로 가기">
          {detail.classes.map((c) => (
            <button key={c.class_id} type="button" className="btn secondary sm" onClick={() => jump(`po-class-${c.class_id}`)}>
              {c.class_name} <span className="muted">{c.students.filter((m) => !pending.includes(m.rel_id)).length}</span>
            </button>
          ))}
          {detail.suspended.length ? <button type="button" className="btn secondary sm" onClick={() => jump('po-suspended')}>휴강 반 <span className="muted">{detail.suspended.length}</span></button> : null}
        </ScrollRow>
      ) : null}
      {detail.classes.map((c) => {
        const members = c.students.filter((m) => !pending.includes(m.rel_id));
        return (
          <section key={c.class_id} id={`po-class-${c.class_id}`} className="card po-class">
            <div className="card-head">
              <div className="po-class-title">
                <h2><Link href={`/classes/${c.class_id}`}>{c.class_name}</Link></h2>
                {c.status !== '운영' ? <span className="tag muted">{c.status}</span> : null}
                <span className="muted">{c.schedule_label} · 수업 {c.lesson_days}회</span>
              </div>
              <span className="cluster po-class-actions">
                <Link className="btn secondary sm" href={`/today?class=${c.class_id}`}>수업 기록하기</Link>
                <Link className="btn ghost sm" href={`/reports?tab=daily&class=${c.class_id}`}>일일 리포트</Link>
                <button type="button" className="btn secondary sm" onClick={() => setAdding(c)}>학생 추가</button>
              </span>
            </div>
            {members.length ? (
              <>
                <div className="table-wrap po-members">
                  <table className="data-table">
                    <thead><tr><th>학생</th><th>원래 반</th><th>기간</th><th>상태</th><th /></tr></thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.rel_id}>
                          <td><Link href={`/students/${m.student_id}`}>{m.name}</Link></td>
                          <td>{m.source_class_name || '-'}</td>
                          <td>{shortDate(m.start_date)} ~ {shortDate(m.end_date)}</td>
                          <td><StateTag m={m} /></td>
                          <td className="num">
                            <span className="cluster po-member-actions">
                              <button type="button" className="btn secondary sm" onClick={() => setReturning(m)}>복귀일 변경</button>
                              {!m.has_lessons ? <button type="button" className="btn ghost sm danger-text" onClick={() => remove(m)}>빼기</button> : null}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="po-cards">
                  {members.map((m) => (
                    <li key={m.rel_id} className="po-card">
                      <div className="po-card-head"><Link className="po-card-name" href={`/students/${m.student_id}`}>{m.name}</Link><StateTag m={m} /></div>
                      <span className="muted">원래 반 {m.source_class_name || '-'} · {shortDate(m.start_date)} ~ {shortDate(m.end_date)}</span>
                      <div className="po-card-actions">
                        <button type="button" className="btn secondary sm" onClick={() => setReturning(m)}>복귀일 변경</button>
                        {!m.has_lessons ? <button type="button" className="btn ghost sm danger-text" onClick={() => remove(m)}>빼기</button> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : <EmptyState>학생이 없습니다.</EmptyState>}
          </section>
        );
      })}
      <section id="po-suspended" className="card po-class">
        <div className="card-head"><h2>휴강 반 {detail.suspended.length}</h2><button type="button" className="btn secondary sm" onClick={() => setEditSuspend(true)}>휴강 반 변경</button></div>
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

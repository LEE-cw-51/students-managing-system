'use client';

import { useRef, useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import WeekdaySchedule from '@/components/ui/WeekdaySchedule';
import { useToast } from '@/components/ui/Toast';
import { SelectAllCheckbox, useSelection } from '@/components/ui/useSelection';
import { api, useApi } from '@/lib/client-api';
import { OUT, classNameKey, mergeTargets, studentEndDate } from '@/lib/exam-planner';
import { shortDate } from '@/lib/format';

const SELECT_STYLE = { width: 'auto', minHeight: 32, padding: '4px 8px' };

function nextName(cards) {
  const taken = new Set(cards.map((c) => classNameKey(c.class_name)));
  let n = cards.filter((c) => !c.existing).length + 1;
  while (taken.has(`시험대비 반 ${n}`)) n += 1;
  return `시험대비 반 ${n}`;
}

/** Build exam classes by hand: add class cards, then pick students from the pool into them. */
function PlannerBody({ data, periodId, onApplied, firstTime }) {
  const toast = useToast();
  const p = data.period;
  const seq = useRef(0);
  const blankCard = (list) => ({
    key: `n${(seq.current += 1)}`, existing: false, include: true, class_name: nextName(list),
    schedule: [], teacher: '', start_date: p.start_date, end_date: p.end_date, students: []
  });
  const [cards, setCards] = useState(() => {
    const existing = (data.existing_classes || []).map((c) => ({
      key: `c-${c.class_id}`, existing: true, include: true, class_id: c.class_id, class_name: c.class_name,
      schedule: c.schedule || [], schedule_label: c.schedule_label, status: c.status, teacher: '',
      start_date: p.start_date, end_date: p.end_date, students: []
    }));
    return existing.length ? existing : [blankCard(existing)];
  });
  const [suspended, setSuspended] = useState(() => new Set(data.suspended_class_ids.length ? data.suspended_class_ids : data.regular_classes.filter((c) => c.suggested).map((c) => c.class_id)));
  const [filter, setFilter] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const byId = new Map(data.students.map((s) => [s.student_id, s]));
  const placed = new Set(cards.flatMap((c) => c.students));
  const pool = data.students.filter((s) => !placed.has(s.student_id));
  const q = filter.trim();
  const visible = pool.filter((s) => !q || s.name.includes(q) || (s.school || '').includes(q));
  const sel = useSelection(visible.map((s) => s.student_id));
  const picked = pool.filter((s) => sel.selected.has(s.student_id));
  const targetKey = cards.some((c) => c.key === target) ? target : (cards[0] ? cards[0].key : '');

  const setCard = (key, patch) => setCards((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const addCard = () => setCards((list) => [...list, blankCard(list)]);
  const removeCard = (key) => setCards((list) => list.filter((c) => c.key !== key));
  const placePicked = () => {
    if (!picked.length || !targetKey) return;
    const ids = picked.map((s) => s.student_id);
    setCards((list) => list.map((c) => (c.key === targetKey ? { ...c, students: [...c.students, ...ids] } : c)));
    sel.setAll(ids, false);
  };
  const moveStudent = (from, sid, to) => setCards((list) => list.map((c) => {
    if (c.key === from) return { ...c, students: c.students.filter((id) => id !== sid) };
    if (c.key === to) return { ...c, students: [...c.students, sid] };
    return c;
  }));
  const toggleSuspend = (id) => setSuspended((set) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const existingKeys = new Set(cards.filter((c) => c.existing).map((c) => classNameKey(c.class_name)));
  const mergeInto = mergeTargets(cards);
  const mergesExisting = (c) => !c.existing && existingKeys.has(classNameKey(c.class_name));
  const active = cards.filter((c) => c.students.length);
  const studentCount = active.reduce((n, c) => n + c.students.length, 0);
  const classCount = active.length - mergeInto.filter((t) => t >= 0).length;

  const apply = async () => {
    setError('');
    const label = (c) => classNameKey(c.class_name) || '이름 없는 반';
    const unnamed = active.find((c) => !classNameKey(c.class_name));
    if (unnamed) return setError('반 이름을 입력해 주세요.');
    const badDate = active.find((c) => !c.existing && (!c.start_date || !c.end_date || c.end_date < c.start_date));
    if (badDate) return setError(`${label(badDate)}: 시작일과 종료일을 확인해 주세요.`);
    const bad = cards.find((c, i) => c.students.length && !c.existing && mergeInto[i] < 0 && !mergesExisting(c)
      && (!c.schedule.length || c.schedule.some((s) => !s.start || !s.end || s.end <= s.start)));
    if (bad) return setError(`${label(bad)}: 수업 요일과 시간을 확인해 주세요.`);
    setSaving(true);
    try {
      await api('applyExamGroups', periodId, {
        groups: active.map((c) => ({
          class_name: c.class_name, schedule: c.schedule, teacher: c.teacher,
          start_date: c.start_date, end_date: c.end_date,
          students: c.students.map((id) => {
            const s = byId.get(id);
            return { student_id: id, source_class_id: s.source_class_id, start_date: c.start_date, end_date: studentEndDate(s, c) };
          })
        })),
        suspended_class_ids: Array.from(suspended)
      });
      toast(`시험대비 반 ${classCount}개, 학생 ${studentCount}명을 편성했습니다.`);
      onApplied();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const studentMeta = (s) => `${s.grade} · ${s.school || '학교 미입력'}${s.source_class_name ? ` · ${s.source_class_name}` : ''}`;

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        반을 만들고 학생을 골라 넣으세요. 학생은 학교 수학 시험일(등록된 경우)까지 시험대비 반에 있다가 다음 날 원래 반으로 돌아갑니다.
        반 이름이 같으면 한 반으로 편성되고, 이 기간에 이미 있는 시험대비 반과 이름이 같으면 그 반에 학생이 추가됩니다.
      </p>

      {cards.map((c, i) => (
        <section key={c.key} className="card plan-group">
          <div className="card-head">
            {c.existing ? (
              <div>
                <h3 style={{ marginBottom: 2 }}>{c.class_name}{c.status && c.status !== '운영' ? <span className="tag muted" style={{ marginLeft: 6 }}>{c.status}</span> : null}</h3>
                <span className="muted">기존 반 · {c.schedule_label || '시간 미정'} · 추가 {c.students.length}명</span>
              </div>
            ) : <h3 style={{ margin: 0 }}>{classNameKey(c.class_name) || '이름 없는 반'} · {c.students.length}명</h3>}
            {!c.existing ? <button type="button" className="btn ghost sm" onClick={() => removeCard(c.key)}>반 삭제</button> : null}
          </div>
          {mergeInto[i] >= 0 && !cards[mergeInto[i]].existing ? <p className="hint" style={{ marginTop: 0 }}>‘{classNameKey(cards[mergeInto[i]].class_name)}’ 반과 이름이 같아 한 반으로 편성됩니다. 요일·시간은 앞의 반 것을 씁니다.</p> : null}
          {mergesExisting(c) ? <p className="hint" style={{ marginTop: 0 }}>이 기간에 있는 ‘{classNameKey(c.class_name)}’ 반과 이름이 같아 그 반에 학생이 추가됩니다.</p> : null}
          <div className="plan-grid">
            {c.existing ? null : (
              <div className="stack-sm">
                <div className="field"><label htmlFor={`gn-${c.key}`}>반 이름</label><input id={`gn-${c.key}`} value={c.class_name} onChange={(e) => setCard(c.key, { class_name: e.target.value })} /></div>
                <div className="cluster">
                  <div className="field" style={{ minWidth: 0 }}><label htmlFor={`gs-${c.key}`}>시작일</label><input id={`gs-${c.key}`} type="date" min={p.start_date} max={p.end_date} value={c.start_date} onChange={(e) => setCard(c.key, { start_date: e.target.value })} /></div>
                  <div className="field" style={{ minWidth: 0 }}><label htmlFor={`ge-${c.key}`}>종료일</label><input id={`ge-${c.key}`} type="date" min={p.start_date} max={p.end_date} value={c.end_date} onChange={(e) => setCard(c.key, { end_date: e.target.value })} /></div>
                </div>
                <div className="field"><label>수업 요일 · 시간</label><WeekdaySchedule value={c.schedule} onChange={(v) => setCard(c.key, { schedule: v })} /></div>
                <div className="field"><label htmlFor={`gt-${c.key}`}>담당 강사</label><input id={`gt-${c.key}`} value={c.teacher} onChange={(e) => setCard(c.key, { teacher: e.target.value })} /></div>
              </div>
            )}
            <div>
              <div className="sr-label" style={{ marginBottom: 6 }}>학생</div>
              {c.students.length ? (
                <ul className="plan-students">
                  {c.students.map((id) => {
                    const s = byId.get(id);
                    const end = studentEndDate(s, c);
                    return (
                      <li key={id}>
                        <span><strong>{s.name}</strong> <span className="muted">{studentMeta(s)}</span>{!s.source_class_id ? <span className="tag warn" style={{ marginLeft: 6 }}>반 미배정</span> : null}</span>
                        <span className="cluster">
                          <span className={'tag ' + (end && end === s.exam_date ? 'ok' : 'muted')}>~{shortDate(end)}{s.source_class_id ? ' 복귀' : ''}</span>
                          <select value={c.key} aria-label={`${s.name} 옮기기`} onChange={(e) => moveStudent(c.key, id, e.target.value === OUT ? '' : e.target.value)} style={SELECT_STYLE}>
                            {cards.map((oc) => <option key={oc.key} value={oc.key}>{oc.key === c.key ? '이 반' : `→ ${classNameKey(oc.class_name) || '이름 없는 반'}`}</option>)}
                            <option value={OUT}>빼기</option>
                          </select>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="hint" style={{ margin: 0 }}>아래 재원생 목록에서 학생을 골라 넣으세요.</p>}
            </div>
          </div>
        </section>
      ))}
      <div><button type="button" className="btn secondary" onClick={addCard}>+ 반 추가</button></div>

      <section className="card">
        <div className="card-head"><h3 style={{ margin: 0 }}>재원생 {pool.length}명</h3></div>
        {data.students.length ? (
          <div className="stack-sm">
            <div className="field"><label htmlFor="plan-filter">학생 찾기</label><input id="plan-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="이름 또는 학교" /></div>
            <div className="split">
              <label className="check-label"><SelectAllCheckbox sel={sel} label="검색 결과 전체 선택" /> 검색 결과 전체 선택</label>
              <span className="cluster">
                <span className="muted" aria-live="polite">선택한 {picked.length}명 →</span>
                <select value={targetKey} aria-label="넣을 반" onChange={(e) => setTarget(e.target.value)} style={SELECT_STYLE}>
                  {cards.map((c) => <option key={c.key} value={c.key}>{classNameKey(c.class_name) || '이름 없는 반'}</option>)}
                </select>
                <button type="button" className="btn sm" onClick={placePicked} disabled={!picked.length || !targetKey}>넣기</button>
              </span>
            </div>
            <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
              <table className="data-table stack-mobile">
                <thead><tr><th className="check-col" /><th>이름</th><th>학교 · 학년</th><th>원래 반</th><th>학교 시험일</th></tr></thead>
                <tbody>
                  {visible.length ? visible.map((s) => (
                    <tr key={s.student_id} className="clickable" onClick={() => sel.toggle(s.student_id)} aria-selected={sel.selected.has(s.student_id)}
                      style={sel.selected.has(s.student_id) ? { background: 'var(--navy-soft)' } : undefined}>
                      <td className="check-col"><input type="checkbox" checked={sel.selected.has(s.student_id)} onChange={() => sel.toggle(s.student_id)} onClick={(e) => e.stopPropagation()} aria-label={`${s.name} 선택`} /></td>
                      <td className="primary">{s.name}</td>
                      <td data-label="학교 · 학년">{s.school || <span className="muted">학교 미입력</span>} {s.grade}</td>
                      <td data-label="원래 반">{s.source_class_name || <span className="tag warn">반 미배정</span>}</td>
                      <td data-label="학교 시험일">{s.exam_date ? shortDate(s.exam_date) : <span className="muted">미등록</span>}</td>
                    </tr>
                  )) : <tr><td colSpan={5} className="muted">{pool.length ? '검색 결과가 없습니다.' : '모든 학생을 반에 넣었습니다.'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ) : <EmptyState title={firstTime ? '편성할 학생이 없습니다' : '아직 편성하지 않은 학생이 없습니다'}>{firstTime ? '재원생이 없습니다.' : '재원생이 모두 편성되었습니다.'}</EmptyState>}
      </section>

      <section className="card">
        <h3>휴강할 원래 반</h3>
        <p className="hint" style={{ marginTop: 0 }}>체크한 반은 시작일에 학생 전원이 시험대비 반으로 옮겨 휴강합니다. 학생은 각자 학교 시험이 끝나면 바로 원래 반으로 돌아오고, 원래 반은 돌아온 학생부터 다시 수업합니다.</p>
        <div className="roster-chips">
          {data.regular_classes.map((c) => (
            <button key={c.class_id} type="button" className={'tag ' + (suspended.has(c.class_id) ? 'amber' : 'muted')} style={{ padding: '6px 10px' }}
              aria-pressed={suspended.has(c.class_id)} onClick={() => toggleSuspend(c.class_id)}>
              {suspended.has(c.class_id) ? '✓ 휴강 · ' : ''}{c.class_name}
            </button>
          ))}
        </div>
      </section>

      {error ? <div className="error-box" role="alert">{error}</div> : null}
      <div className="save-bar">
        <span className="save-state">시험대비 반 {classCount}개 · 학생 {studentCount}명 · 휴강 {suspended.size}개 반</span>
        <button type="button" className="btn" onClick={apply} disabled={saving || (!active.length && firstTime)}>{saving ? '편성 중…' : '편성 확정'}</button>
      </div>
    </div>
  );
}

export default function Planner({ periodId, onApplied, firstTime }) {
  const state = useApi(() => api('proposeExamGroups', periodId), [periodId]);
  return <Async state={state}>{(d) => <PlannerBody data={d} periodId={periodId} onApplied={onApplied} firstTime={firstTime} />}</Async>;
}

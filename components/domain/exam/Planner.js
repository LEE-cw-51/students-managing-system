'use client';

import { useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import WeekdaySchedule from '@/components/ui/WeekdaySchedule';
import { useToast } from '@/components/ui/Toast';
import { api, useApi } from '@/lib/client-api';
import { OUT, excludeGroup, includeGroup } from '@/lib/exam-planner';
import { shortDate } from '@/lib/format';

/** Proposal → adjust → confirm. Students can move between groups or stay out. */
function PlannerBody({ data, periodId, onApplied, firstTime }) {
  const toast = useToast();
  const [groups, setGroups] = useState(() => data.groups.map((g) => ({ ...g, include: true })));
  const [pool, setPool] = useState(() => data.unassigned.map((u) => ({ ...u, target: OUT })));
  const [suspended, setSuspended] = useState(() => new Set(data.suspended_class_ids.length ? data.suspended_class_ids : data.regular_classes.filter((c) => c.suggested).map((c) => c.class_id)));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const setGroup = (i, patch) => setGroups((list) => list.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const setInclude = (i, include) => {
    if (include) {
      setGroups((list) => includeGroup(list, i));
      return;
    }
    const next = excludeGroup(groups, pool, i);
    setGroups(next.groups);
    setPool(next.pool);
  };
  const moveStudent = (from, sid, to) => {
    setGroups((list) => {
      const st = list[from].students.find((s) => s.student_id === sid);
      return list.map((g, j) => {
        if (j === from) return { ...g, students: g.students.filter((s) => s.student_id !== sid) };
        if (String(j) === to) return { ...g, students: [...g.students, st] };
        return g;
      });
    });
    if (to === OUT) {
      const st = groups[from].students.find((s) => s.student_id === sid);
      setPool((p) => [...p, { ...st, target: OUT }]);
    }
  };
  const placeFromPool = (sid, to) => {
    if (to === OUT) return;
    const st = pool.find((p) => p.student_id === sid);
    setPool((p) => p.filter((x) => x.student_id !== sid));
    setGroups((list) => list.map((g, j) => (String(j) === to ? { ...g, students: [...g.students, st] } : g)));
  };
  const toggleSuspend = (id) => setSuspended((set) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const active = groups.filter((g) => g.include && g.students.length);
  const studentCount = active.reduce((n, g) => n + g.students.length, 0);

  const apply = async () => {
    setError('');
    const bad = active.find((g) => !g.schedule.length || g.schedule.some((s) => !s.start || !s.end || s.end <= s.start));
    if (bad) return setError(`${bad.class_name}: 수업 요일과 시간을 확인해 주세요.`);
    setSaving(true);
    try {
      await api('applyExamGroups', periodId, {
        groups: active.map((g) => ({
          class_name: g.class_name, schedule: g.schedule, teacher: g.teacher, target_school: g.target_school, target_grade: g.target_grade,
          start_date: g.start_date, end_date: g.end_date,
          students: g.students.map((s) => ({ student_id: s.student_id, source_class_id: s.source_class_id }))
        })),
        suspended_class_ids: Array.from(suspended)
      });
      toast(`시험대비 반 ${active.length}개, 학생 ${studentCount}명을 편성했습니다.`);
      onApplied();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const p = data.period;
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        재원생을 학교·학년별로 묶은 제안입니다. 반 이름·시간·날짜를 고치고, 학생을 다른 반으로 옮기거나 빼세요. 그룹 체크를 해제하면 학생은 「편성 안 된 학생」으로 이동합니다. 종료일은 그 학교 수학 시험일이 기본값입니다.
      </p>
      {groups.length ? groups.map((g, i) => (
        <section key={g.key} className={'card plan-group' + (g.include ? '' : ' is-off')}>
          <div className="card-head">
            <label className="check-label"><input type="checkbox" checked={g.include} onChange={(e) => setInclude(i, e.target.checked)} /> {g.target_school} {g.target_grade} · {g.students.length}명</label>
            {g.exam_date ? <span className="tag">학교 시험 {shortDate(g.exam_date)}</span> : <span className="tag muted">학교 시험일 미등록</span>}
          </div>
          {g.include ? (
            <div className="plan-grid">
              <div className="stack-sm">
                <div className="field"><label htmlFor={`gn-${i}`}>반 이름</label><input id={`gn-${i}`} value={g.class_name} onChange={(e) => setGroup(i, { class_name: e.target.value })} /></div>
                <div className="cluster">
                  <div className="field" style={{ minWidth: 0 }}><label htmlFor={`gs-${i}`}>시작일</label><input id={`gs-${i}`} type="date" min={p.start_date} max={p.end_date} value={g.start_date} onChange={(e) => setGroup(i, { start_date: e.target.value })} /></div>
                  <div className="field" style={{ minWidth: 0 }}><label htmlFor={`ge-${i}`}>종료일 (이후 원래 반 복귀)</label><input id={`ge-${i}`} type="date" min={p.start_date} max={p.end_date} value={g.end_date} onChange={(e) => setGroup(i, { end_date: e.target.value })} /></div>
                </div>
                <div className="field"><label>수업 요일 · 시간</label><WeekdaySchedule value={g.schedule} onChange={(v) => setGroup(i, { schedule: v })} /></div>
              </div>
              <div>
                <div className="sr-label" style={{ marginBottom: 6 }}>학생</div>
                <ul className="plan-students">
                  {g.students.map((s) => (
                    <li key={s.student_id}>
                      <span><strong>{s.name}</strong> <span className="muted">{s.school} · {s.source_class_name}</span></span>
                      <select value={String(i)} aria-label={`${s.name} 옮기기`} onChange={(e) => moveStudent(i, s.student_id, e.target.value)} style={{ width: 'auto', minHeight: 32, padding: '4px 8px' }}>
                        {groups.map((og, j) => <option key={og.key} value={String(j)}>{j === i ? '이 반' : `→ ${og.class_name}`}</option>)}
                        <option value={OUT}>빼기</option>
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </section>
      )) : <div className="card"><EmptyState title={firstTime ? '편성할 학생이 없습니다' : '아직 편성하지 않은 학생이 없습니다'}>정규 반에 배정된 재원생만 편성 대상입니다.</EmptyState></div>}

      {pool.length ? (
        <section className="card">
          <h3>편성 안 된 학생 {pool.length}명</h3>
          <p className="hint" style={{ marginTop: 0 }}>학교가 입력되지 않았거나 뺀 학생입니다. 그대로 두면 기간 동안 시험대비 수업이 없습니다.</p>
          <ul className="plan-students">
            {pool.map((s) => (
              <li key={s.student_id}>
                <span><strong>{s.name}</strong> <span className="muted">{s.grade} · {s.school || '학교 미입력'} · {s.source_class_name}</span></span>
                <select value={OUT} aria-label={`${s.name} 넣을 반`} onChange={(e) => placeFromPool(s.student_id, e.target.value)} style={{ width: 'auto', minHeight: 32, padding: '4px 8px' }}>
                  <option value={OUT}>넣을 반 선택</option>
                  {groups.map((g, j) => g.include ? <option key={g.key} value={String(j)}>{g.class_name}</option> : null)}
                </select>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
        <span className="save-state">시험대비 반 {active.length}개 · 학생 {studentCount}명 · 휴강 {suspended.size}개 반</span>
        <button type="button" className="btn" onClick={apply} disabled={saving || (!active.length && firstTime)}>{saving ? '편성 중…' : '편성 확정'}</button>
      </div>
    </div>
  );
}

export default function Planner({ periodId, onApplied, firstTime }) {
  const state = useApi(() => api('proposeExamGroups', periodId), [periodId]);
  return <Async state={state}>{(d) => <PlannerBody data={d} periodId={periodId} onApplied={onApplied} firstTime={firstTime} />}</Async>;
}

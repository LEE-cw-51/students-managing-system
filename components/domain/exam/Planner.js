'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Async, EmptyState } from '@/components/ui/Feedback';
import WeekdaySchedule from '@/components/ui/WeekdaySchedule';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useDirty } from '@/components/ui/useDirty';
import { SelectAllCheckbox, useSelection } from '@/components/ui/useSelection';
import ScrollRow from '@/components/domain/exam/ScrollRow';
import { api, useApi } from '@/lib/client-api';
import { OUT, classNameKey, mergeTargets, studentEndDate } from '@/lib/exam-planner';
import { shortDate } from '@/lib/format';

const SELECT_STYLE = { width: 'auto', minHeight: 32, padding: '4px 8px' };
const UNDO_MS = 5000;
const SECTIONS = ['pl-classes', 'pl-pool', 'pl-suspend'];

function nextName(cards) {
  const taken = new Set(cards.map((c) => classNameKey(c.class_name)));
  let n = cards.filter((c) => !c.existing).length + 1;
  while (taken.has(`시험대비 반 ${n}`)) n += 1;
  return `시험대비 반 ${n}`;
}

function useUnsavedGuard(dirty) {
  const router = useRouter();
  const confirm = useConfirm();
  useEffect(() => {
    if (!dirty) return undefined;
    let leaving = false;
    const onBeforeUnload = (e) => {
      if (leaving) return;
      e.preventDefault();
      e.returnValue = '';
    };
    // Links can't wait for the in-app dialog, so the click is held and replayed once confirmed.
    const onClick = (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]');
      const href = a ? a.getAttribute('href') || '' : '';
      if (!a || a.target === '_blank' || a.hasAttribute('download') || !href || href.startsWith('#') || href.startsWith('tel:') || href.startsWith('mailto:')) return;
      e.preventDefault();
      e.stopPropagation();
      confirm({
        title: '저장하지 않은 편성',
        message: '편성 확정을 누르지 않은 변경이 있습니다. 이 화면을 떠날까요?',
        confirmLabel: '저장하지 않고 떠나기',
        danger: true
      }).then((ok) => {
        if (!ok) return;
        const url = new URL(a.href, window.location.href);
        if (url.origin === window.location.origin) {
          router.push(url.pathname + url.search + url.hash);
        } else {
          leaving = true;
          window.location.assign(url.href);
        }
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

/** Section the reader is in: the last one whose top has passed under the sticky nav. */
function useActiveSection(navRef) {
  const [section, setSection] = useState(SECTIONS[0]);
  useEffect(() => {
    const onScroll = () => {
      const nav = navRef.current;
      const line = (nav ? nav.getBoundingClientRect().bottom : 0) + 24;
      let current = SECTIONS[0];
      SECTIONS.forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = SECTIONS[SECTIONS.length - 1];
      setSection(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [navRef]);
  return [section, setSection];
}

function groupPool(students) {
  const groups = new Map();
  students.forEach((s) => {
    const key = `${s.school || ''}|${s.grade || ''}`;
    if (!groups.has(key)) groups.set(key, { key, school: s.school || '', grade: s.grade || '', students: [] });
    groups.get(key).students.push(s);
  });
  return [...groups.values()].sort((a, b) => {
    if (!a.school !== !b.school) return a.school ? -1 : 1;
    return a.school.localeCompare(b.school, 'ko') || a.grade.localeCompare(b.grade, 'ko');
  });
}

/** Build exam classes by hand: add class cards, then pick students from the pool into them. */
function PlannerBody({ data, periodId, onApplied, firstTime, onDirty }) {
  const toast = useToast();
  const p = data.period;
  const seq = useRef(0);
  const navRef = useRef(null);
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
  const [openKeys, setOpenKeys] = useState(() => new Set(cards.filter((c) => !c.existing).map((c) => c.key)));
  const [suspended, setSuspended] = useState(() => new Set(data.suspended_class_ids.length ? data.suspended_class_ids : data.regular_classes.filter((c) => c.suggested).map((c) => c.class_id)));
  const [filter, setFilter] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useActiveSection(navRef);

  const dirty = useDirty({ cards, suspended: Array.from(suspended).sort() });
  useUnsavedGuard(dirty && !saving);
  useEffect(() => { if (onDirty) onDirty(dirty); }, [dirty, onDirty]);

  const byId = new Map(data.students.map((s) => [s.student_id, s]));
  const placed = new Set(cards.flatMap((c) => c.students));
  const pool = data.students.filter((s) => !placed.has(s.student_id));
  const q = filter.trim();
  const visible = pool.filter((s) => !q || s.name.includes(q) || (s.school || '').includes(q));
  const sel = useSelection(visible.map((s) => s.student_id));
  const picked = pool.filter((s) => sel.selected.has(s.student_id));
  const targetKey = cards.some((c) => c.key === target) ? target : (cards[0] ? cards[0].key : '');
  const groups = groupPool(visible);

  const setCard = (key, patch) => setCards((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const toggleOpen = (key, on) => setOpenKeys((set) => {
    const next = new Set(set);
    if (on === undefined ? !next.has(key) : on) next.add(key); else next.delete(key);
    return next;
  });
  const addCard = () => {
    const card = blankCard(cards);
    setCards((list) => [...list, card]);
    toggleOpen(card.key, true);
  };
  const removeCard = (key) => {
    const at = cards.findIndex((c) => c.key === key);
    if (at < 0) return;
    const card = cards[at];
    setCards((list) => list.filter((c) => c.key !== key));
    const restore = () => setCards((list) => {
      if (list.some((c) => c.key === card.key)) return list;
      const taken = new Set(list.flatMap((c) => c.students));
      const next = [...list];
      next.splice(Math.min(at, next.length), 0, { ...card, students: card.students.filter((id) => !taken.has(id)) });
      return next;
    });
    toast(`‘${classNameKey(card.class_name) || '이름 없는 반'}’ 반을 지웠습니다.${card.students.length ? ` 학생 ${card.students.length}명은 남은 학생으로 돌아갔습니다.` : ''}`, 'ok', {
      duration: UNDO_MS,
      action: { label: '되돌리기', onClick: restore }
    });
  };
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
  const jump = (id) => {
    setSection(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const showCard = (c, field) => {
    toggleOpen(c.key, true);
    requestAnimationFrame(() => {
      const el = document.getElementById(field ? `${field}-${c.key}` : `card-${c.key}`) || document.getElementById(`card-${c.key}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (field) el.focus({ preventScroll: true });
    });
  };

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
    if (unnamed) { showCard(unnamed, 'gn'); return setError('반 이름을 입력해 주세요.'); }
    const badDate = active.find((c) => !c.existing && (!c.start_date || !c.end_date || c.end_date < c.start_date));
    if (badDate) { showCard(badDate, 'gs'); return setError(`${label(badDate)}: 시작일과 종료일을 확인해 주세요.`); }
    const bad = cards.find((c, i) => c.students.length && !c.existing && mergeInto[i] < 0 && !mergesExisting(c)
      && (!c.schedule.length || c.schedule.some((s) => !s.start || !s.end || s.end <= s.start)));
    if (bad) { showCard(bad); return setError(`${label(bad)}: 수업 요일과 시간을 확인해 주세요.`); }
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
      setSaving(false);
    }
  };

  const studentMeta = (s) => `${s.grade} · ${s.school || '학교 미입력'}${s.source_class_name ? ` · ${s.source_class_name}` : ''}`;
  const cardSummary = (c) => [c.existing ? `${c.class_name} (기존 반)` : classNameKey(c.class_name) || '이름 없는 반',
    c.existing ? c.schedule_label || '시간 미정' : c.schedule.length ? c.schedule.map((s) => `${s.day} ${s.start || ''}`.trim()).join(', ') : '',
    c.existing ? `추가 ${c.students.length}명` : `${c.students.length}명`].filter(Boolean).join(' · ');
  const navItems = [
    ['pl-classes', `① 시험대비 반 ${cards.length}`],
    ['pl-pool', `② 학생 넣기 · 남은 ${pool.length}명`],
    ['pl-suspend', `③ 휴강할 원래 반 ${suspended.size}`]
  ];

  return (
    <div className="planner">
      <ScrollRow className="pl-nav" label="편성 구획" ref={navRef}>
        {navItems.map(([id, label]) => (
          <button key={id} type="button" className="pl-nav-item" aria-current={section === id ? 'true' : undefined} onClick={() => jump(id)}>{label}</button>
        ))}
      </ScrollRow>

      <section id="pl-classes" className="pl-section">
        <div className="pl-section-head">
          <h2>① 시험대비 반</h2>
          <button type="button" className="btn secondary sm" onClick={addCard}>+ 반 추가</button>
        </div>
        <details className="ex-help">
          <summary>반 이름이 같으면?</summary>
          <p>학생은 학교 수학 시험일(등록된 경우)까지 시험대비 반에 있다가 다음 날 원래 반으로 돌아갑니다. 반 이름이 같으면 한 반으로 편성되고, 이 기간에 이미 있는 시험대비 반과 이름이 같으면 그 반에 학생이 추가됩니다.</p>
        </details>
        <div className="pl-class-grid">
          {cards.map((c, i) => {
            const open = openKeys.has(c.key);
            return (
              <section key={c.key} id={`card-${c.key}`} className={'card plan-group' + (open ? ' is-open' : '')}>
                <div className="pl-card-head">
                  <button type="button" className="pl-card-toggle" aria-expanded={open} onClick={() => toggleOpen(c.key)}>
                    <span className="pl-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
                    <span className="pl-card-title">{open ? (c.existing ? `${c.class_name} (기존 반) · 추가 ${c.students.length}명` : `${classNameKey(c.class_name) || '이름 없는 반'} · ${c.students.length}명`) : cardSummary(c)}</span>
                    {c.status && c.status !== '운영' ? <span className="tag muted">{c.status}</span> : null}
                  </button>
                  {!c.existing ? <button type="button" className="btn ghost sm danger-text" onClick={() => removeCard(c.key)}>반 삭제</button> : null}
                </div>
                {mergeInto[i] >= 0 && !cards[mergeInto[i]].existing ? <p className="hint" style={{ margin: '6px 0 0' }}>‘{classNameKey(cards[mergeInto[i]].class_name)}’ 반과 이름이 같아 한 반으로 편성됩니다. 요일·시간은 앞의 반 것을 씁니다.</p> : null}
                {mergesExisting(c) ? <p className="hint" style={{ margin: '6px 0 0' }}>이 기간에 있는 ‘{classNameKey(c.class_name)}’ 반과 이름이 같아 그 반에 학생이 추가됩니다.</p> : null}
                {open ? (
                  <div className="pl-card-body">
                    {c.existing ? <span className="muted">기존 반 · {c.schedule_label || '시간 미정'}</span> : (
                      <div className="stack-sm">
                        <div className="field"><label htmlFor={`gn-${c.key}`}>반 이름</label><input id={`gn-${c.key}`} value={c.class_name} onChange={(e) => setCard(c.key, { class_name: e.target.value })} /></div>
                        <div className="pl-dates">
                          <div className="field"><label htmlFor={`gs-${c.key}`}>시작일</label><input id={`gs-${c.key}`} type="date" min={p.start_date} max={p.end_date} value={c.start_date} onChange={(e) => setCard(c.key, { start_date: e.target.value })} /></div>
                          <div className="field"><label htmlFor={`ge-${c.key}`}>종료일</label><input id={`ge-${c.key}`} type="date" min={p.start_date} max={p.end_date} value={c.end_date} onChange={(e) => setCard(c.key, { end_date: e.target.value })} /></div>
                        </div>
                        <div className="field"><label>수업 요일 · 시간</label><WeekdaySchedule value={c.schedule} onChange={(v) => setCard(c.key, { schedule: v })} /></div>
                        <div className="field"><label htmlFor={`gt-${c.key}`}>담당 강사</label><input id={`gt-${c.key}`} value={c.teacher} onChange={(e) => setCard(c.key, { teacher: e.target.value })} /></div>
                      </div>
                    )}
                    <div>
                      <div className="sr-label" style={{ marginBottom: 6 }}>학생 {c.students.length}명</div>
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
                      ) : <p className="hint" style={{ margin: 0 }}>② 학생 넣기에서 학생을 골라 넣으세요.</p>}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </section>

      <section id="pl-pool" className="pl-section">
        <div className="pl-section-head">
          <h2>② 학생 넣기</h2>
          <span className="muted">남은 재원생 {pool.length}명</span>
        </div>
        {data.students.length ? (
          <>
            <div className={'pl-pick-bar' + (picked.length ? ' is-sticky' : '')}>
              <input className="pl-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="이름 또는 학교로 찾기" aria-label="학생 찾기" />
              <label className="check-label"><SelectAllCheckbox sel={sel} label="검색 결과 전체 선택" /> 검색 결과 전체</label>
              <span className="pl-pick-target">
                <strong aria-live="polite">선택 {picked.length}명 →</strong>
                <select value={targetKey} aria-label="넣을 반" onChange={(e) => setTarget(e.target.value)}>
                  {cards.map((c) => <option key={c.key} value={c.key}>{classNameKey(c.class_name) || '이름 없는 반'}</option>)}
                </select>
                <button type="button" className="btn sm" onClick={placePicked} disabled={!picked.length || !targetKey}>넣기</button>
              </span>
            </div>
            {groups.length ? (
              <div className="table-wrap pl-pool">
                <table className="data-table">
                  <thead><tr><th className="check-col" /><th>이름</th><th>원래 반</th><th>학교 · 학년</th><th>학교 시험일</th></tr></thead>
                  {groups.map((g) => {
                    const ids = g.students.map((s) => s.student_id);
                    const on = ids.filter((sid) => sel.selected.has(sid)).length;
                    const gsel = { allOn: on === ids.length, someOn: on > 0 && on < ids.length, visibleIds: ids, setAll: sel.setAll };
                    const label = g.school ? `${g.school} ${g.grade}` : `학교 미입력 ${g.grade}`.trim();
                    const examDate = (g.students.find((s) => s.exam_date) || {}).exam_date;
                    return (
                      <tbody key={g.key}>
                        <tr className="pl-group-head">
                          <td colSpan={5}>
                            <label className="check-label"><SelectAllCheckbox sel={gsel} label={`${label} 전체 선택`} /> {label}<span className="muted">{examDate ? ` · 시험 ${shortDate(examDate)}` : ''} · {ids.length}명</span></label>
                          </td>
                        </tr>
                        {g.students.map((s) => (
                          <tr key={s.student_id} className="clickable" onClick={() => sel.toggle(s.student_id)} aria-selected={sel.selected.has(s.student_id)}>
                            <td className="check-col"><input type="checkbox" checked={sel.selected.has(s.student_id)} onChange={() => sel.toggle(s.student_id)} onClick={(e) => e.stopPropagation()} aria-label={`${s.name} 선택`} /></td>
                            <td className="pl-name">{s.name}</td>
                            <td className="pl-source">{s.source_class_name || <span className="tag warn">반 미배정</span>}</td>
                            <td className="pl-school">{s.school || <span className="muted">학교 미입력</span>} {s.grade}</td>
                            <td className="pl-exam">{s.exam_date ? shortDate(s.exam_date) : <span className="muted">미등록</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    );
                  })}
                </table>
              </div>
            ) : <p className="muted" style={{ margin: 0 }}>{pool.length ? '검색 결과가 없습니다.' : '모든 학생을 반에 넣었습니다.'}</p>}
          </>
        ) : <div className="card"><EmptyState title={firstTime ? '편성할 학생이 없습니다' : '아직 편성하지 않은 학생이 없습니다'}>{firstTime ? '재원생이 없습니다.' : '재원생이 모두 편성되었습니다.'}</EmptyState></div>}
      </section>

      <section id="pl-suspend" className="pl-section">
        <div className="pl-section-head"><h2>③ 휴강할 원래 반</h2></div>
        <details className="ex-help">
          <summary>휴강하면 어떻게 되나요?</summary>
          <p>체크한 반은 시작일에 학생 전원이 시험대비 반으로 옮겨 휴강합니다. 학생은 각자 학교 시험이 끝나면 바로 원래 반으로 돌아오고, 원래 반은 돌아온 학생부터 다시 수업합니다.</p>
        </details>
        <div className="roster-chips pl-suspend-chips">
          {data.regular_classes.map((c) => (
            <button key={c.class_id} type="button" className={'tag ' + (suspended.has(c.class_id) ? 'amber' : 'muted')}
              aria-pressed={suspended.has(c.class_id)} onClick={() => toggleSuspend(c.class_id)}>
              {suspended.has(c.class_id) ? '✓ 휴강 · ' : ''}{c.class_name}
            </button>
          ))}
        </div>
      </section>

      <div className="save-bar pl-save">
        {error ? <div className="error-box save-bar-error" role="alert">{error}</div> : null}
        <span className="save-state">시험대비 반 {classCount}개 · 학생 {studentCount}명 · 휴강 {suspended.size}개 반 · 남은 {pool.length}명</span>
        <button type="button" className="btn" onClick={apply} disabled={saving || (!active.length && firstTime)}>{saving ? '편성 중…' : '편성 확정'}</button>
      </div>
    </div>
  );
}

export default function Planner({ periodId, onApplied, firstTime, onDirty }) {
  const state = useApi(() => api('proposeExamGroups', periodId), [periodId]);
  return <Async state={state}>{(d) => <PlannerBody data={d} periodId={periodId} onApplied={onApplied} firstTime={firstTime} onDirty={onDirty} />}</Async>;
}

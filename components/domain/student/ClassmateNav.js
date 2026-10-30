'use client';

import { useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, useApi } from '@/lib/client-api';

// Rosters survive the page remount that happens on every student change, so the bar does not blink.
const rosterCache = new Map();

/** Prev/next + dropdown to jump between students of the same class. Keeps ?tab and sets ?class. */
export default function ClassmateNav({ studentId, classes, disabled }) {
  const router = useRouter();
  const params = useSearchParams();
  const wanted = params.get('class');
  const classId = classes.some((c) => String(c.class_id) === wanted) ? wanted : (classes[0] ? String(classes[0].class_id) : null);

  const members = useApi(() => (classId ? api('getClassMembers', classId) : null), [classId]);
  useEffect(() => {
    if (classId && members.data) rosterCache.set(classId, members.data.current);
  }, [classId, members.data]);
  // While loading, members.data may still hold the previously selected class.
  const roster = members.loading ? (rosterCache.get(classId) || []) : (members.data?.current || []);

  const index = roster.findIndex((m) => String(m.student_id) === studentId);
  const prev = index > 0 ? roster[index - 1] : null;
  const next = index >= 0 && index < roster.length - 1 ? roster[index + 1] : null;

  const hrefFor = useCallback((targetId, targetClass) => {
    const q = new URLSearchParams();
    const tab = params.get('tab');
    if (tab) q.set('tab', tab);
    if (targetClass) q.set('class', targetClass);
    return '/students/' + encodeURIComponent(targetId) + '?' + q.toString();
  }, [params]);
  const go = (targetId) => router.push(hrefFor(targetId, classId));

  useEffect(() => {
    if (disabled) return undefined;
    const onKey = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      if (document.querySelector('.modal-backdrop')) return;
      const target = e.key === 'ArrowLeft' ? prev : next;
      if (!target) return;
      e.preventDefault();
      router.push(hrefFor(target.student_id, classId));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, prev, next, classId, hrefFor, router]);

  if (!classId || index < 0) return null;

  return (
    <nav className="classmate-nav" aria-label="같은 반 학생 이동">
      {classes.length > 1 ? (
        <select
          aria-label="반 선택"
          value={classId}
          onChange={(e) => router.replace(hrefFor(studentId, e.target.value), { scroll: false })}
        >
          {classes.map((c) => <option key={c.class_id} value={String(c.class_id)}>{c.class_name}</option>)}
        </select>
      ) : (
        <span className="classmate-nav-class">{classes[0].class_name}</span>
      )}
      <button type="button" className="btn secondary sm" disabled={!prev} onClick={() => go(prev.student_id)} title="이전 학생 (Alt+←)">‹ 이전</button>
      <select className="classmate-nav-student" aria-label="학생 선택" value={studentId} onChange={(e) => go(e.target.value)}>
        {roster.map((m, i) => (
          <option key={m.student_id} value={String(m.student_id)}>
            {String(m.student_id) === studentId ? `${m.name} (${i + 1}/${roster.length})` : m.name}
          </option>
        ))}
      </select>
      <button type="button" className="btn secondary sm" disabled={!next} onClick={() => go(next.student_id)} title="다음 학생 (Alt+→)">다음 ›</button>
    </nav>
  );
}

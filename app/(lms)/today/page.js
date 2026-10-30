'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useRef } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import TodayBoard from '@/components/domain/today/TodayBoard';
import LessonRecorder from '@/components/domain/today/LessonRecorder';
import WeekStrip from '@/components/domain/today/WeekStrip';
import { useBoot } from '@/components/shell/AppShell';
import { formatDate, relativeDay } from '@/lib/format';

function addDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function TodayView() {
  const boot = useBoot();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : boot.today;
  const classId = params.get('class') || '';

  const navigate = (next) => {
    const q = new URLSearchParams(params.toString());
    Object.entries(next).forEach(([k, v]) => (v ? q.set(k, v) : q.delete(k)));
    if (q.get('date') === boot.today) q.delete('date');
    const qs = q.toString();
    router.push(pathname + (qs ? '?' + qs : ''), { scroll: false });
  };
  // Set by LessonRecorder while it is mounted; asks before unsaved edits are thrown away.
  const guardRef = useRef(null);
  const registerGuard = useCallback((fn) => { guardRef.current = fn; }, []);
  const go = async (next) => {
    if (guardRef.current && !(await guardRef.current())) return;
    navigate(next);
  };

  const rel = relativeDay(date, boot.today);
  return (
    <>
      <PageHeader
        crumbs={classId ? [{ href: pathname + (date !== boot.today ? `?date=${date}` : ''), label: '오늘' }] : null}
        title={classId ? '수업 기록' : '오늘'}
        sub={`${formatDate(date, true)}${rel && rel !== '오늘' ? ` · ${rel}` : ''}`}
        actions={(
          <div className="cluster">
            <button type="button" className="btn secondary sm" aria-label="이전 날" onClick={() => go({ date: addDays(date, -1) })}>◀</button>
            <input type="date" value={date} aria-label="날짜" onChange={(e) => e.target.value && go({ date: e.target.value })} style={{ width: 'auto', minHeight: 34 }} />
            <button type="button" className="btn secondary sm" aria-label="다음 날" onClick={() => go({ date: addDays(date, 1) })}>▶</button>
            {date !== boot.today ? <button type="button" className="btn secondary sm" onClick={() => go({ date: '' })}>오늘</button> : null}
          </div>
        )}
      />
      {classId ? (
        <LessonRecorder classId={classId} date={date} onGoDate={(d) => navigate({ date: d })} onGuard={registerGuard} />
      ) : (
        <>
          <WeekStrip date={date} today={boot.today} onPick={(d) => go({ date: d })} />
          <TodayBoard date={date} onOpenClass={(id) => go({ class: id })} />
        </>
      )}
    </>
  );
}

export default function TodayPage() {
  return (
    <Suspense fallback={null}>
      <TodayView />
    </Suspense>
  );
}

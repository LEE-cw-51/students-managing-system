'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useRef } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import TodayBoard from '@/components/domain/today/TodayBoard';
import LessonRecorder from '@/components/domain/today/LessonRecorder';
import WeekStrip from '@/components/domain/today/WeekStrip';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';
import { formatDate, relativeDay } from '@/lib/format';

function TodayView() {
  const boot = useBoot();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : boot.today;
  const classId = params.get('class') || '';
  const board = useApi(() => (classId ? null : api('getTodayBoard', date)), [date, classId]);

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

  if (classId) {
    return (
      <LessonRecorder classId={classId} date={date} today={boot.today}
        backHref={pathname + (date !== boot.today ? `?date=${date}` : '')}
        onGoDate={(d) => navigate({ date: d })} onGuard={registerGuard} />
    );
  }
  const rel = relativeDay(date, boot.today);
  return (
    <>
      <PageHeader
        title="오늘"
        sub={`${formatDate(date, true)}${rel && rel !== '오늘' ? ` · ${rel}` : ''}`}
        actions={date !== boot.today ? <button type="button" className="btn secondary sm" onClick={() => go({ date: '' })}>오늘로</button> : null}
      />
      <WeekStrip date={date} today={boot.today} week={board.data && board.data.week} onPick={(d) => go({ date: d })} />
      <TodayBoard date={date} state={board} onOpenClass={(id) => go({ class: id })} />
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

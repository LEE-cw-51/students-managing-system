'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Tabs, { useTab } from '@/components/ui/Tabs';
import DailyReports from '@/components/domain/report/DailyReports';
import MonthlyBoard from '@/components/domain/report/MonthlyBoard';
import { useBoot } from '@/components/shell/AppShell';

const TABS = [
  { key: 'daily', label: '일간 보고서' },
  { key: 'monthly', label: '월간 보고서' }
];

function ReportsView() {
  const boot = useBoot();
  const tab = useTab(TABS);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (patch) => {
    const q = new URLSearchParams(params.toString());
    Object.entries(patch).forEach(([k, v]) => (v ? q.set(k, v) : q.delete(k)));
    router.replace(pathname + '?' + q.toString(), { scroll: false });
  };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : boot.today;
  const month = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month') : boot.today.slice(0, 7);
  const classId = params.get('class') || '';
  return (
    <>
      <PageHeader title="보고서" sub={tab === 'daily' ? '반·날짜별 학생 일일 보고서를 확인하고 학부모님께 보낼 문구를 복사합니다.' : '반·월별 월간 보고서 상태를 보고, 한 번에 만들고, 확정·PDF 저장합니다.'} />
      <Tabs tabs={TABS} current={tab} />
      {tab === 'daily' ? <DailyReports date={date} classId={classId} onChange={set} /> : <MonthlyBoard ym={month} classId={classId} onChange={set} />}
    </>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportsView />
    </Suspense>
  );
}

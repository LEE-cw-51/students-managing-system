'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Tabs, { useTab } from '@/components/ui/Tabs';
import { Async } from '@/components/ui/Feedback';
import ClassForm from '@/components/domain/class/ClassForm';
import { OverviewTab, ProgressTab, HomeworkTab, TestsTab, StudentsTab, StatsTab } from '@/components/domain/class/ClassTabs';
import PlansTab from '@/components/domain/class/PlansTab';
import { api, useApi } from '@/lib/client-api';

const TABS = [
  { key: 'overview', label: '개요' },
  { key: 'progress', label: '진도 기록' },
  { key: 'homework', label: '숙제 기록' },
  { key: 'tests', label: '테스트 기록' },
  { key: 'plans', label: '강의 계획' },
  { key: 'students', label: '학생' },
  { key: 'stats', label: '통계' }
];

function Workspace() {
  const { id } = useParams();
  const tab = useTab(TABS);
  const [editing, setEditing] = useState(false);
  const overview = useApi(() => api('getClassOverview', id), [id]);

  return (
    <Async state={overview}>
      {(data) => {
        const cls = data.class;
        const sub = [cls.schedule_label, cls.grade, cls.teacher && `담당 ${cls.teacher}`, cls.textbook].filter(Boolean).join(' · ');
        return (
          <>
            <PageHeader
              crumbs={[{ href: '/classes', label: '반' }]}
              title={<>{cls.class_name}{cls.status !== '운영' ? <span className="tag muted" style={{ marginLeft: 8, verticalAlign: 'middle' }}>{cls.status}</span> : null}{cls.class_type === '시험대비' ? <span className="tag amber" style={{ marginLeft: 8, verticalAlign: 'middle' }}>시험대비</span> : null}</>}
              sub={sub || '시간표가 없습니다. 정보 수정에서 요일과 시간을 입력하세요.'}
              actions={(
                <>
                  <Link className="btn" href={`/today?class=${cls.class_id}`}>수업 기록하기</Link>
                  <button type="button" className="btn secondary" onClick={() => setEditing(true)}>정보 수정</button>
                </>
              )}
            />
            <Tabs tabs={TABS} current={tab} />
            {tab === 'overview' ? <OverviewTab data={data} /> : null}
            {tab === 'progress' ? <ProgressTab classId={id} onChanged={overview.reload} /> : null}
            {tab === 'homework' ? <HomeworkTab classId={id} /> : null}
            {tab === 'tests' ? <TestsTab classId={id} /> : null}
            {tab === 'plans' ? <PlansTab classId={id} /> : null}
            {tab === 'students' ? <StudentsTab classId={id} onChanged={overview.reload} /> : null}
            {tab === 'stats' ? <StatsTab classId={id} today={data.today} /> : null}
            {editing ? (
              <ClassForm initial={cls} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); overview.reload(); }} />
            ) : null}
          </>
        );
      }}
    </Async>
  );
}

export default function ClassPage() {
  return (
    <Suspense fallback={null}>
      <Workspace />
    </Suspense>
  );
}

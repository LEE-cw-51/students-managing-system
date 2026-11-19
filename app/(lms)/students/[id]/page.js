'use client';

import { useParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import Tabs, { TabPanel, useTab } from '@/components/ui/Tabs';
import PageHeader from '@/components/ui/PageHeader';
import { Async, PageSkeleton } from '@/components/ui/Feedback';
import Badges from '@/components/domain/Badges';
import StudentForm from '@/components/domain/student/StudentForm';
import {
  OverviewTab, LessonsTab, HomeworkTab, GradesTab
} from '@/components/domain/student/StudentTabs';
import CounselingTab from '@/components/domain/student/CounselingTab';
import ClassmateNav from '@/components/domain/student/ClassmateNav';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';
import { telHref } from '@/lib/format';

const TABS = [
  { key: 'overview', label: '개요' },
  { key: 'lessons', label: '수업·출결' },
  { key: 'homework', label: '숙제' },
  { key: 'grades', label: '성적' },
  { key: 'counseling', label: '상담·보고서' }
];

function Workspace() {
  const { id } = useParams();
  const boot = useBoot();
  const tab = useTab(TABS);
  const [editing, setEditing] = useState(false);
  const header = useApi(() => api('getStudent', id), [id]);
  const overview = useApi(() => api('getStudentOverview', id), [id]);

  const reload = () => Promise.all([header.reload(), overview.reload()]);

  return (
    <Async state={header}>
      {(s) => {
        const meta = [s.grade, s.school, s.enrollment_date ? `등록 ${s.enrollment_date}` : ''].filter(Boolean).join(' · ');
        const ov = overview.data;
        return (
          <>
            <PageHeader
              className="sd-header"
              back={{ href: '/students', label: '‹ 학생' }}
              title={s.name}
              sub={meta || null}
              badges={(
                <>
                  {s.status !== '재원' ? <span className="tag muted">{s.status}</span> : null}
                  {ov && ov.badges.length ? <Badges badges={ov.badges} /> : null}
                </>
              )}
              actions={(
                <>
                  {telHref(s.parent_phone) ? <a className="btn secondary" href={telHref(s.parent_phone)}>학부모 전화</a> : null}
                  <button type="button" className="btn secondary" onClick={() => setEditing(true)}>정보 수정</button>
                </>
              )}
            />
            {ov ? <ClassmateNav studentId={id} classes={ov.classes} disabled={editing} /> : null}
            <Tabs tabs={TABS} current={tab} scrollHint />
            <TabPanel tabKey="overview" current={tab}>
              <Async state={overview}>
                {(data) => <OverviewTab data={data} onChanged={overview.reload} />}
              </Async>
            </TabPanel>
            <TabPanel tabKey="lessons" current={tab}>
              <LessonsTab studentId={id} today={boot.today} />
            </TabPanel>
            <TabPanel tabKey="homework" current={tab}>
              <HomeworkTab studentId={id} />
            </TabPanel>
            <TabPanel tabKey="grades" current={tab}>
              <GradesTab studentId={id} />
            </TabPanel>
            <TabPanel tabKey="counseling" current={tab}>
              <CounselingTab studentId={id} onChanged={overview.reload} />
            </TabPanel>
            {editing ? <StudentForm initial={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} /> : null}
          </>
        );
      }}
    </Async>
  );
}

export default function StudentPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Workspace />
    </Suspense>
  );
}

'use client';

import { useParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Tabs, { useTab } from '@/components/ui/Tabs';
import { Async } from '@/components/ui/Feedback';
import Badges from '@/components/domain/Badges';
import StudentForm from '@/components/domain/student/StudentForm';
import {
  OverviewTab, AttendanceTab, LessonsTab, HomeworkTab, GradesTab, ReportsTab, HistoryTab
} from '@/components/domain/student/StudentTabs';
import CounselingTab from '@/components/domain/student/CounselingTab';
import { api, useApi } from '@/lib/client-api';

const TABS = [
  { key: 'overview', label: '개요' },
  { key: 'attendance', label: '출결' },
  { key: 'lessons', label: '수업 기록' },
  { key: 'homework', label: '숙제' },
  { key: 'grades', label: '성적' },
  { key: 'counseling', label: '상담' },
  { key: 'reports', label: '보고서' },
  { key: 'history', label: '반 이력' }
];

function Workspace() {
  const { id } = useParams();
  const tab = useTab(TABS);
  const [editing, setEditing] = useState(false);
  const overview = useApi(() => api('getStudentOverview', id), [id]);

  return (
    <Async state={overview}>
      {(data) => {
        const s = data.student;
        const sub = [s.grade, s.school, data.classes.map((c) => c.class_name).join(', ')].filter(Boolean).join(' · ');
        return (
          <>
            <PageHeader
              crumbs={[{ href: '/students', label: '학생' }]}
              title={<>{s.name}{s.status !== '재원' ? <span className="tag muted" style={{ marginLeft: 8, verticalAlign: 'middle' }}>{s.status}</span> : null}</>}
              sub={<>{sub || (data.unassigned ? '미배정' : '반 배정 없음')}{data.badges.length ? <div style={{ marginTop: 6 }}><Badges badges={data.badges} /></div> : null}</>}
              actions={(
                <>
                  {s.parent_phone ? <a className="btn secondary" href={`tel:${s.parent_phone}`}>학부모 전화</a> : null}
                  <button type="button" className="btn secondary" onClick={() => setEditing(true)}>정보 수정</button>
                </>
              )}
            />
            <Tabs tabs={TABS} current={tab} />
            {tab === 'overview' ? <OverviewTab data={data} onChanged={overview.reload} /> : null}
            {tab === 'attendance' ? <AttendanceTab studentId={id} today={data.today} /> : null}
            {tab === 'lessons' ? <LessonsTab studentId={id} /> : null}
            {tab === 'homework' ? <HomeworkTab studentId={id} /> : null}
            {tab === 'grades' ? <GradesTab studentId={id} /> : null}
            {tab === 'counseling' ? <CounselingTab studentId={id} onChanged={overview.reload} /> : null}
            {tab === 'reports' ? <ReportsTab studentId={id} /> : null}
            {tab === 'history' ? <HistoryTab studentId={id} /> : null}
            {editing ? <StudentForm initial={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); overview.reload(); }} /> : null}
          </>
        );
      }}
    </Async>
  );
}

export default function StudentPage() {
  return (
    <Suspense fallback={null}>
      <Workspace />
    </Suspense>
  );
}

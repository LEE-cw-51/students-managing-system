'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import Tabs, { useTab } from '@/components/ui/Tabs';
import { Async } from '@/components/ui/Feedback';
import Badges from '@/components/domain/Badges';
import StudentForm from '@/components/domain/student/StudentForm';
import {
  OverviewTab, LessonsTab, HomeworkTab, GradesTab
} from '@/components/domain/student/StudentTabs';
import CounselingTab from '@/components/domain/student/CounselingTab';
import ClassmateNav from '@/components/domain/student/ClassmateNav';
import { api, useApi } from '@/lib/client-api';

const TABS = [
  { key: 'overview', label: '개요' },
  { key: 'lessons', label: '수업·출결' },
  { key: 'homework', label: '숙제' },
  { key: 'grades', label: '성적' },
  { key: 'counseling', label: '상담·보고서' }
];

const LEGACY_TABS = { attendance: 'lessons', reports: 'counseling', history: 'overview' };

function Workspace() {
  const { id } = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const legacy = LEGACY_TABS[params.get('tab')];
  const current = useTab(TABS);
  const tab = legacy || current;
  const [historyOpen] = useState(() => params.get('tab') === 'history');
  const [editing, setEditing] = useState(false);
  const overview = useApi(() => api('getStudentOverview', id), [id]);

  useEffect(() => {
    if (!legacy) return;
    const next = new URLSearchParams(params.toString());
    if (legacy === TABS[0].key) next.delete('tab');
    else next.set('tab', legacy);
    const qs = next.toString();
    router.replace(pathname + (qs ? '?' + qs : ''), { scroll: false });
  }, [legacy, params, pathname, router]);

  return (
    <Async state={overview}>
      {(data) => {
        const s = data.student;
        const meta = [s.grade, s.school, s.enrollment_date ? `등록 ${s.enrollment_date}` : ''].filter(Boolean).join(' · ');
        return (
          <>
            <div className="page-header sd-header">
              <div className="page-header-title">
                <Link className="rec-back" href="/students">‹ 학생</Link>
                <h1 className="display">{s.name}</h1>
                {meta ? <span className="sub">{meta}</span> : null}
                {s.status !== '재원' ? <span className="tag muted">{s.status}</span> : null}
                {data.badges.length ? <Badges badges={data.badges} /> : null}
              </div>
              <div className="page-actions">
                {s.parent_phone ? <a className="btn secondary" href={`tel:${s.parent_phone}`}>학부모 전화</a> : null}
                <button type="button" className="btn secondary" onClick={() => setEditing(true)}>정보 수정</button>
              </div>
            </div>
            <ClassmateNav studentId={id} classes={data.classes} disabled={editing} />
            <Tabs tabs={TABS} current={tab} scrollHint />
            {tab === 'overview' ? <OverviewTab data={data} onChanged={overview.reload} historyOpen={historyOpen} /> : null}
            {tab === 'lessons' ? <LessonsTab studentId={id} today={data.today} /> : null}
            {tab === 'homework' ? <HomeworkTab studentId={id} /> : null}
            {tab === 'grades' ? <GradesTab studentId={id} /> : null}
            {tab === 'counseling' ? <CounselingTab studentId={id} onChanged={overview.reload} /> : null}
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

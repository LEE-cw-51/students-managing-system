'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import Tabs, { TabPanel, useTab } from '@/components/ui/Tabs';
import PageHeader from '@/components/ui/PageHeader';
import { Async, PageSkeleton } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import ClassForm from '@/components/domain/class/ClassForm';
import { OverviewTab, HomeworkTab, TestsTab, StudentsTab, StatsTab } from '@/components/domain/class/ClassTabs';
import PlansTab from '@/components/domain/class/PlansTab';
import { api, useApi } from '@/lib/client-api';
import { useBoot } from '@/components/shell/AppShell';
import { useConfirm } from '@/components/ui/ConfirmDialog';

const GROUPS = [
  { key: 'regular', label: '운영 중 · 정규', test: (c) => c.status === '운영' && c.class_type !== '시험대비' },
  { key: 'exam', label: '운영 중 · 시험대비', test: (c) => c.status === '운영' && c.class_type === '시험대비' },
  { key: 'closed', label: '종료', test: (c) => c.status !== '운영' }
];

/** Jump to another class without going back to the list; the open tab stays the same. */
function ClassSwitcher({ currentId, tab }) {
  const boot = useBoot();
  const router = useRouter();
  const all = (boot.search.classes || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const groups = GROUPS.map((g) => ({ ...g, items: all.filter(g.test) })).filter((g) => g.items.length);
  const mine = groups.find((g) => g.items.some((c) => c.id === currentId));
  if (!mine || all.length < 2) return null;
  const i = mine.items.findIndex((c) => c.id === currentId);
  const go = (id) => { if (id && id !== currentId) router.push(`/classes/${id}?tab=${tab}`); };
  const prev = mine.items[i - 1];
  const next = mine.items[i + 1];
  return (
    <div className="cluster class-switcher">
      <button type="button" className="btn secondary sm" disabled={!prev} onClick={() => go(prev && prev.id)} aria-label={prev ? `이전 반 ${prev.name}` : '이전 반 없음'}>◀</button>
      <select value={currentId} onChange={(e) => go(e.target.value)} aria-label="다른 반으로 이동" style={{ width: 'auto' }}>
        {groups.map((g) => (
          <optgroup key={g.key} label={g.label}>
            {g.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </optgroup>
        ))}
      </select>
      <button type="button" className="btn secondary sm" disabled={!next} onClick={() => go(next && next.id)} aria-label={next ? `다음 반 ${next.name}` : '다음 반 없음'}>▶</button>
    </div>
  );
}

const TABS = [
  { key: 'overview', label: '개요' },
  { key: 'lessons', label: '수업 계획·기록' },
  { key: 'homework', label: '숙제' },
  { key: 'tests', label: '테스트' },
  { key: 'students', label: '학생' },
  { key: 'stats', label: '통계' }
];

function Workspace() {
  const confirm = useConfirm();
  const { id } = useParams();
  const router = useRouter();
  const tab = useTab(TABS);
  const boot = useBoot();
  const toast = useToast();
  const [editing, setEditing] = useState('');
  const [planVersion, setPlanVersion] = useState(0);
  const header = useApi(() => api('getClass', id), [id]);
  const overview = useApi(() => api('getClassOverview', id), [id]);

  const reload = () => Promise.all([header.reload(), overview.reload()]);

  const remove = async () => {
    if (!(await confirm({ message: '이 반과 배정·강의 계획을 모두 삭제할까요? 되돌릴 수 없습니다.', confirmLabel: '삭제', danger: true }))) return;
    try { await api('deleteClass', id); toast('삭제했습니다.'); boot.refresh(); router.push('/classes'); } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <Async state={header}>
      {(cls) => {
        const ov = overview.data;
        const schedule = (ov && ov.class && ov.class.schedule_label)
          || cls.schedule_label
          || (boot.search.classes || []).find((c) => c.id === id)?.schedule_label
          || '';
        const studentCount = ov ? ov.roster.length : (cls.student_count ?? (cls.students || []).length);
        const meta = [schedule || '시간표 없음', cls.grade, `학생 ${studentCount}명`].filter(Boolean).join(' · ');
        const period = ov && ov.exam && ov.exam.period;
        const back = cls.class_type === '시험대비' && cls.exam_period_id
          ? { href: `/exams/periods/${cls.exam_period_id}`, label: `‹ ${(period && period.title) || '시험대비 기간'}` }
          : { href: '/classes', label: '‹ 반' };
        return (
          <>
            <PageHeader
              className="cd-header"
              back={back}
              title={cls.class_name}
              sub={meta}
              badges={(
                <>
                  {cls.status !== '운영' ? <span className="tag muted">{cls.status}</span> : null}
                  {cls.class_type === '시험대비' ? <span className="tag amber">시험대비</span> : null}
                </>
              )}
              actions={(
                <>
                  <ClassSwitcher currentId={cls.class_id} tab={tab} />
                  <Link className="btn" href={`/today?class=${cls.class_id}`}>수업 기록</Link>
                  <button type="button" className="btn secondary" onClick={() => setEditing('info')}>정보 수정</button>
                </>
              )}
            />
            <Tabs tabs={TABS} current={tab} scrollHint />
            <TabPanel tabKey="overview" current={tab}>
              <Async state={overview}>
                {(data) => <OverviewTab data={data} />}
              </Async>
            </TabPanel>
            <TabPanel tabKey="lessons" current={tab}>
              <PlansTab classId={id} version={planVersion} onEditCurriculum={() => setEditing('curriculum')} />
            </TabPanel>
            <TabPanel tabKey="homework" current={tab}>
              <HomeworkTab classId={id} />
            </TabPanel>
            <TabPanel tabKey="tests" current={tab}>
              <TestsTab classId={id} />
            </TabPanel>
            <TabPanel tabKey="students" current={tab}>
              <StudentsTab classId={id} onChanged={overview.reload} />
            </TabPanel>
            <TabPanel tabKey="stats" current={tab}>
              <StatsTab classId={id} today={boot.today} />
            </TabPanel>
            {editing ? (
              <ClassForm initial={cls} section={editing === 'curriculum' ? 'curriculum' : ''}
                onDelete={editing === 'info' && ov && !ov.has_lessons ? remove : null}
                onClose={() => setEditing('')}
                onSaved={() => { setEditing(''); setPlanVersion((v) => v + 1); reload(); }} />
            ) : null}
          </>
        );
      }}
    </Async>
  );
}

export default function ClassPage() {
  const { id } = useParams();
  // A fresh workspace per class: switching classes resets selections, open dialogs and the plan month.
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Workspace key={id} />
    </Suspense>
  );
}

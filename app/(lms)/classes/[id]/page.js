'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Tabs, { useTab } from '@/components/ui/Tabs';
import { Async } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import ClassForm from '@/components/domain/class/ClassForm';
import { OverviewTab, ProgressTab, HomeworkTab, TestsTab, StudentsTab, StatsTab } from '@/components/domain/class/ClassTabs';
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
  { key: 'progress', label: '진도 기록' },
  { key: 'homework', label: '숙제 기록' },
  { key: 'tests', label: '테스트 기록' },
  { key: 'plans', label: '강의 계획' },
  { key: 'students', label: '학생' },
  { key: 'stats', label: '통계' }
];

function Workspace() {
  const confirm = useConfirm();
  const { id } = useParams();
  const tab = useTab(TABS);
  const router = useRouter();
  const boot = useBoot();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const overview = useApi(() => api('getClassOverview', id), [id]);

  const remove = async () => {
    if (!(await confirm({ message: '이 반과 배정·강의 계획을 모두 삭제할까요? 되돌릴 수 없습니다.', confirmLabel: '삭제', danger: true }))) return;
    try { await api('deleteClass', id); toast('삭제했습니다.'); boot.refresh(); router.push('/classes'); } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <Async state={overview}>
      {(data) => {
        const cls = data.class;
        const sub = [cls.schedule_label, cls.grade, cls.teacher && `담당 ${cls.teacher}`, cls.textbook].filter(Boolean).join(' · ');
        const period = data.exam && data.exam.period;
        const crumbs = cls.class_type === '시험대비' && cls.exam_period_id
          ? [{ href: '/exams?tab=periods', label: '시험대비 기간' }, { href: `/exams/periods/${cls.exam_period_id}`, label: (period && period.title) || '기간 상세' }]
          : [{ href: '/classes', label: '반' }];
        return (
          <>
            <PageHeader
              crumbs={crumbs}
              title={<>{cls.class_name}{cls.status !== '운영' ? <span className="tag muted" style={{ marginLeft: 8, verticalAlign: 'middle' }}>{cls.status}</span> : null}{cls.class_type === '시험대비' ? <span className="tag amber" style={{ marginLeft: 8, verticalAlign: 'middle' }}>시험대비</span> : null}</>}
              sub={sub || '시간표가 없습니다. 정보 수정에서 요일과 시간을 입력하세요.'}
              actions={(
                <>
                  <ClassSwitcher currentId={cls.class_id} tab={tab} />
                  <Link className="btn" href={`/today?class=${cls.class_id}`}>수업 기록하기</Link>
                  <button type="button" className="btn secondary" onClick={() => setEditing(true)}>정보 수정</button>
                  {!data.has_lessons ? <button type="button" className="btn ghost" style={{ color: 'var(--red)' }} onClick={remove}>삭제</button> : null}
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
  const { id } = useParams();
  // A fresh workspace per class: switching classes resets selections, open dialogs and the plan month.
  return (
    <Suspense fallback={null}>
      <Workspace key={id} />
    </Suspense>
  );
}

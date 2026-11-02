'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import Tabs, { useTab } from '@/components/ui/Tabs';
import { Async } from '@/components/ui/Feedback';
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

const LEGACY_TABS = { progress: 'lessons', plans: 'lessons' };

function Workspace() {
  const confirm = useConfirm();
  const { id } = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const legacy = LEGACY_TABS[params.get('tab')];
  const current = useTab(TABS);
  const tab = legacy || current;
  const boot = useBoot();
  const toast = useToast();
  const [editing, setEditing] = useState('');
  const [planVersion, setPlanVersion] = useState(0);
  const overview = useApi(() => api('getClassOverview', id), [id]);

  useEffect(() => {
    if (!legacy) return;
    const next = new URLSearchParams(params.toString());
    next.set('tab', legacy);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [legacy, params, pathname, router]);

  const remove = async () => {
    if (!(await confirm({ message: '이 반과 배정·강의 계획을 모두 삭제할까요? 되돌릴 수 없습니다.', confirmLabel: '삭제', danger: true }))) return;
    try { await api('deleteClass', id); toast('삭제했습니다.'); boot.refresh(); router.push('/classes'); } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <Async state={overview}>
      {(data) => {
        const cls = data.class;
        const meta = [cls.schedule_label || '시간표 없음', cls.grade, `학생 ${data.roster.length}명`].filter(Boolean).join(' · ');
        const period = data.exam && data.exam.period;
        const back = cls.class_type === '시험대비' && cls.exam_period_id
          ? { href: `/exams/periods/${cls.exam_period_id}`, label: `‹ ${(period && period.title) || '시험대비 기간'}` }
          : { href: '/classes', label: '‹ 반' };
        return (
          <>
            <div className="page-header cd-header">
              <div className="page-header-title">
                <Link className="rec-back" href={back.href}>{back.label}</Link>
                <h1 className="display">{cls.class_name}</h1>
                {cls.status !== '운영' ? <span className="tag muted">{cls.status}</span> : null}
                {cls.class_type === '시험대비' ? <span className="tag amber">시험대비</span> : null}
                <span className="sub">{meta}</span>
              </div>
              <div className="page-actions">
                <ClassSwitcher currentId={cls.class_id} tab={tab} />
                <Link className="btn" href={`/today?class=${cls.class_id}`}>수업 기록</Link>
                <button type="button" className="btn secondary" onClick={() => setEditing('info')}>정보 수정</button>
              </div>
            </div>
            <Tabs tabs={TABS} current={tab} scrollHint />
            {tab === 'overview' ? <OverviewTab data={data} /> : null}
            {tab === 'lessons' ? <PlansTab classId={id} version={planVersion} onEditCurriculum={() => setEditing('curriculum')} /> : null}
            {tab === 'homework' ? <HomeworkTab classId={id} /> : null}
            {tab === 'tests' ? <TestsTab classId={id} /> : null}
            {tab === 'students' ? <StudentsTab classId={id} onChanged={overview.reload} /> : null}
            {tab === 'stats' ? <StatsTab classId={id} today={data.today} /> : null}
            {editing ? (
              <ClassForm initial={cls} section={editing === 'curriculum' ? 'curriculum' : ''}
                onDelete={editing === 'info' && !data.has_lessons ? remove : null}
                onClose={() => setEditing('')}
                onSaved={() => { setEditing(''); setPlanVersion((v) => v + 1); overview.reload(); }} />
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

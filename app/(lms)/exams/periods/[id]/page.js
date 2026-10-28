'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Async } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import PeriodForm from '@/components/domain/exam/PeriodForm';
import Planner from '@/components/domain/exam/Planner';
import PeriodOperation from '@/components/domain/exam/PeriodOperation';
import { api, useApi } from '@/lib/client-api';
import { formatDate } from '@/lib/format';
import { useConfirm } from '@/components/ui/ConfirmDialog';

const STATE_TONE = { 예정: 'muted', '진행 중': 'ok', 끝남: 'muted', 마감: 'muted' };

export default function PeriodPage() {
  const confirm = useConfirm();
  const { id } = useParams();
  const router = useRouter();
  const boot = useBoot();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const state = useApi(() => api('getExamPeriodDetail', id), [id]);
  const changed = () => { state.reload(); boot.refresh(); };

  const close = async () => {
    if (!(await confirm({ message: '기간을 마감할까요? 시험대비 반이 ‘종료’로 바뀝니다. 기록은 그대로 남습니다.', confirmLabel: '마감' }))) return;
    try { await api('closeExamPeriod', id); toast('마감했습니다.'); changed(); } catch (err) { toast(err.message, 'error'); }
  };
  const remove = async () => {
    if (!(await confirm({ message: '이 기간과 시험대비 반·배정을 모두 삭제할까요?', confirmLabel: '삭제', danger: true }))) return;
    try { await api('deleteExamPeriod', id); toast('삭제했습니다.'); boot.refresh(); router.push('/exams?tab=periods'); } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <Async state={state}>
      {(d) => {
        const p = d.period;
        const fresh = !d.classes.length;
        return (
          <>
            <PageHeader
              crumbs={[{ href: '/exams?tab=periods', label: '시험대비 기간' }]}
              title={<>{p.title} <span className={'tag ' + (STATE_TONE[p.state] || '')} style={{ verticalAlign: 'middle' }}>{p.state}</span></>}
              sub={`${formatDate(p.start_date)} ~ ${formatDate(p.end_date)}${p.exam_type ? ` · ${p.exam_year} ${p.exam_semester}학기 ${p.exam_type}고사` : ''}`}
              actions={(
                <>
                  {!fresh && !planning ? <button type="button" className="btn secondary" onClick={() => setPlanning(true)}>남은 학생 편성</button> : null}
                  <button type="button" className="btn secondary" onClick={() => setEditing(true)}>기간 수정</button>
                  {!fresh && p.state !== '마감' ? <button type="button" className="btn secondary" onClick={close}>기간 마감</button> : null}
                  {!d.has_lessons ? <button type="button" className="btn ghost" style={{ color: 'var(--red)' }} onClick={remove}>삭제</button> : null}
                </>
              )}
            />
            {fresh || planning ? (
              <>
                {fresh ? <h2 style={{ margin: '0 0 12px' }}>시험대비 반 편성</h2> : null}
                {planning ? <div className="split" style={{ marginBottom: 12 }}><h2 style={{ margin: 0 }}>남은 학생 편성</h2><button type="button" className="link-btn" onClick={() => setPlanning(false)}>닫기</button></div> : null}
                <Planner periodId={id} firstTime={fresh} onApplied={() => { setPlanning(false); changed(); }} />
              </>
            ) : <PeriodOperation detail={d} onChanged={changed} />}
            {editing ? <PeriodForm initial={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); changed(); }} /> : null}
          </>
        );
      }}
    </Async>
  );
}

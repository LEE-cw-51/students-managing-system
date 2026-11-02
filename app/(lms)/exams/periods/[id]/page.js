'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
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
  const [planDirty, setPlanDirty] = useState(false);
  const state = useApi(() => api('getExamPeriodDetail', id), [id]);
  const changed = () => { state.reload(); boot.refresh(); };

  const close = async () => {
    if (!(await confirm({ message: '기간을 마감할까요? 시험대비 반이 ‘종료’로 바뀝니다. 기록은 그대로 남습니다.', confirmLabel: '마감' }))) return;
    try { await api('closeExamPeriod', id); toast('마감했습니다.'); changed(); } catch (err) { toast(err.message, 'error'); }
  };
  const remove = async () => {
    if (!(await confirm({ message: '이 기간과 시험대비 반·배정을 모두 삭제할까요? 되돌릴 수 없습니다.', confirmLabel: '기간 삭제', danger: true }))) return;
    try { await api('deleteExamPeriod', id); toast('삭제했습니다.'); setEditing(false); boot.refresh(); router.push('/exams?tab=periods'); } catch (err) { toast(err.message, 'error'); }
  };
  const stopPlanning = async () => {
    if (planDirty && !(await confirm({ message: '저장하지 않은 편성이 있습니다. 닫을까요?', confirmLabel: '저장하지 않고 닫기', danger: true }))) return;
    setPlanDirty(false);
    setPlanning(false);
  };

  return (
    <Async state={state}>
      {(d) => {
        const p = d.period;
        const fresh = !d.classes.length;
        const studentCount = d.classes.reduce((n, c) => n + c.students.length, 0);
        const exam = p.exam_type ? `${p.exam_year} ${p.exam_semester}학기 ${p.exam_type}` : '';
        const meta = [`${formatDate(p.start_date)} ~ ${formatDate(p.end_date)}`]
          .concat(fresh || planning ? (exam ? [exam] : []) : [`반 ${d.classes.length}`, `학생 ${studentCount}`])
          .join(' · ');
        return (
          <div className="period-page">
            <div className="page-header pd-header">
              <div className="page-header-title">
                <Link className="rec-back" href="/exams?tab=periods" aria-label="시험대비 기간 목록">‹</Link>
                <h1 className="display">{p.title}</h1>
                <span className={'tag ' + (STATE_TONE[p.state] || '')}>{p.state}</span>
                <span className="sub">{meta}</span>
                {planning ? <span className="pd-mode">남은 학생 편성 · <button type="button" className="link-btn" onClick={stopPlanning}>닫기</button></span> : null}
              </div>
              <div className="page-actions">
                {!fresh && !planning ? <button type="button" className="btn secondary" onClick={() => setPlanning(true)}>남은 학생 편성</button> : null}
                <button type="button" className="btn secondary" onClick={() => setEditing(true)}>기간 수정</button>
                {!fresh && !planning && p.state !== '마감' ? <button type="button" className="btn secondary" onClick={close}>기간 마감</button> : null}
              </div>
            </div>
            {fresh || planning ? (
              <Planner periodId={id} firstTime={fresh} onDirty={setPlanDirty} onApplied={() => { setPlanDirty(false); setPlanning(false); changed(); }} />
            ) : <PeriodOperation detail={d} onChanged={changed} />}
            {editing ? (
              <PeriodForm initial={p} onDelete={!d.has_lessons ? remove : null}
                onClose={() => setEditing(false)} onSaved={() => { setEditing(false); changed(); }} />
            ) : null}
          </div>
        );
      }}
    </Async>
  );
}

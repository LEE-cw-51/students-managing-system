'use client';

import Modal from '@/components/ui/Modal';
import { Async } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { api, useApi } from '@/lib/client-api';
import { formatDate } from '@/lib/format';

/** All students' daily reports for a class and date, each copyable (학부모 문자용). */
export default function DailyReportsModal({ classId, className, date, onClose }) {
  const toast = useToast();
  const state = useApi(() => api('generateDailyReports', date, classId), [classId, date]);
  const copy = (text) => navigator.clipboard.writeText(text).then(() => toast('복사했습니다.'), () => toast('복사하지 못했습니다.', 'error'));
  return (
    <Modal title={`${className || ''} ${formatDate(date)} 일일 보고서`} onClose={onClose} wide>
      <Async state={state}>
        {(d) => d.reports.length ? (
          <div className="stack">
            {d.reports.map((r) => (
              <article key={r.lesson_id}>
                <div className="split"><strong>{r.student_name}</strong><button type="button" className="btn secondary sm" onClick={() => copy(r.text)}>복사</button></div>
                <pre className="report-text">{r.text}</pre>
              </article>
            ))}
          </div>
        ) : <p className="muted">이 날짜에 저장된 수업 기록이 없습니다.</p>}
      </Async>
    </Modal>
  );
}

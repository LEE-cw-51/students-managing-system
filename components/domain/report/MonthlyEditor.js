'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/client-api';
import { downloadMonthlyPdf, generateMonthlyAi } from '@/lib/report-client';

/** Edit one student's monthly report: regenerate (basic / AI), save draft, confirm, copy, PDF. */
export default function MonthlyEditor({ row, year, month, onClose, onSaved }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [status, setStatus] = useState(row.status);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('generateMonthlyReport', row.student_id, year, month)
      .then((d) => { setText(d.text); setSaved(d.existing ? d.text : ''); })
      .catch((e) => setError(e.message));
  }, [row.student_id, year, month]);

  const run = async (label, fn) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };
  const regenerate = () => run('basic', async () => {
    if (text !== saved && !window.confirm('지금 내용을 기본 보고서로 바꿀까요?')) return;
    const d = await api('generateMonthlyReport', row.student_id, year, month);
    setText(d.generated_text);
  });
  const regenerateAi = () => run('ai', async () => {
    if (text !== saved && !window.confirm('지금 내용을 AI 분석 포함 보고서로 바꿀까요?')) return;
    const d = await generateMonthlyAi(row.student_id, year, month);
    setText(d.text);
  });
  const save = (nextStatus) => run('save', async () => {
    await api('saveMonthlyReport', { student_id: row.student_id, year, month, report_text: text, status: nextStatus });
    setSaved(text);
    setStatus(nextStatus);
    toast(nextStatus === '확정' ? '확정했습니다.' : '임시 저장했습니다.');
    onSaved();
  });
  const pdf = () => run('pdf', () => downloadMonthlyPdf(row.student_id, year, month, text, row.name));
  const copy = () => navigator.clipboard.writeText(text).then(() => toast('복사했습니다.'), () => toast('복사하지 못했습니다.', 'error'));
  const dirty = text !== saved;

  return (
    <Modal title={`${row.name} ${month}월 보고서`} onClose={() => { if (!dirty || window.confirm('저장하지 않은 내용이 있습니다. 닫을까요?')) onClose(); }} wide
      footer={(
        <>
          <span className={'save-state ' + (dirty ? 'dirty' : '')} style={{ marginRight: 'auto' }}>{dirty ? '● 저장 안 됨' : `상태: ${status}`}</span>
          <button type="button" className="btn secondary" onClick={copy} disabled={!text}>복사</button>
          <button type="button" className="btn secondary" onClick={pdf} disabled={!text || !!busy}>{busy === 'pdf' ? 'PDF 만드는 중…' : 'PDF 저장'}</button>
          <button type="button" className="btn secondary" onClick={() => save('임시')} disabled={!text || !!busy}>임시 저장</button>
          <button type="button" className="btn ok" onClick={() => save('확정')} disabled={!text || !!busy}>확정</button>
        </>
      )}>
      <div className="stack">
        <div className="cluster">
          <button type="button" className="btn secondary sm" onClick={regenerate} disabled={!!busy}>{busy === 'basic' ? '만드는 중…' : '기본 보고서로 다시 만들기'}</button>
          <button type="button" className="btn secondary sm" onClick={regenerateAi} disabled={!!busy}>{busy === 'ai' ? 'AI 분석 중… (최대 1분)' : 'AI 분석 포함으로 다시 만들기'}</button>
          <span className="muted">수업 {row.lesson_count}회 기준</span>
        </div>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={18} aria-label="보고서 내용" className="report-editor" />
      </div>
    </Modal>
  );
}

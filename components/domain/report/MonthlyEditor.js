'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/client-api';
import { downloadMonthlyPdf, generateMonthlyAi } from '@/lib/report-client';

export const STATUS_TAG = { 미작성: 'warn', 임시: 'amber', 확정: 'ok' };

/**
 * Edit one student's monthly report: regenerate (basic / AI), save draft, confirm, copy, PDF.
 * `prev` / `next` are the neighbouring rows in the board's current order.
 */
export default function MonthlyEditor({ row, year, month, prev, next, onNavigate, onClose, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [status, setStatus] = useState(row.status);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setText('');
    setSaved('');
    setError('');
    setStatus(row.status);
    api('generateMonthlyReport', row.student_id, year, month)
      .then((d) => {
        if (!live) return;
        setText(d.text);
        setSaved(d.existing ? d.text : '');
        setStatus(d.existing ? String(d.existing.status || '임시') : '미작성');
      })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [row.student_id, row.status, year, month]);

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
    if (text !== saved && !(await confirm({ message: '지금 내용을 기본 보고서로 바꿀까요?', confirmLabel: '바꾸기' }))) return;
    const d = await api('generateMonthlyReport', row.student_id, year, month);
    setText(d.generated_text);
  });
  const regenerateAi = () => run('ai', async () => {
    if (text !== saved && !(await confirm({ message: '지금 내용을 AI 분석 포함 보고서로 바꿀까요?', confirmLabel: '바꾸기' }))) return;
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
  const unconfirm = () => run('save', async () => {
    await api('saveMonthlyReport', { student_id: row.student_id, year, month, report_text: saved, status: '임시' });
    setText(saved);
    setStatus('임시');
    toast('확정을 취소했습니다. 고친 뒤 다시 확정해 주세요.');
    onSaved();
  });
  const locked = status === '확정';
  const pdf = () => run('pdf', () => downloadMonthlyPdf(row.student_id, year, month, text, row.name));
  const copy = () => navigator.clipboard.writeText(text).then(() => toast('복사했습니다.'), () => toast('복사하지 못했습니다.', 'error'));
  const dirty = text !== saved;
  const go = async (target) => {
    if (dirty && !(await confirm({ message: '저장하지 않은 내용이 있습니다. 다른 학생으로 넘어갈까요?', confirmLabel: '넘어가기', danger: true }))) return;
    onNavigate(target);
  };

  return (
    <Modal title={`${row.name} ${month}월 보고서`} onClose={onClose} dirty={dirty} className="rp-editor"
      titleMeta={<span className="rp-editor-meta"><span className={'tag ' + (STATUS_TAG[status] || 'muted')}>{status}</span><span className="muted">수업 {row.lesson_count}회</span></span>}
      headActions={(
        <span className="rp-editor-nav">
          <button type="button" className="btn ghost sm" onClick={() => go(prev)} disabled={!prev || !!busy} aria-label={prev ? `이전 학생 ${prev.name}` : '이전 학생 없음'}>‹ 이전</button>
          <button type="button" className="btn ghost sm" onClick={() => go(next)} disabled={!next || !!busy} aria-label={next ? `다음 학생 ${next.name}` : '다음 학생 없음'}>다음 ›</button>
        </span>
      )}
      footer={(
        <>
          <span className={'save-state ' + (dirty ? 'dirty' : '')}>{dirty ? '● 저장 안 됨' : `상태: ${status}`}</span>
          <span className="rp-editor-buttons">
            <button type="button" className="btn secondary" onClick={copy} disabled={!text}>복사</button>
            <button type="button" className="btn secondary" onClick={pdf} disabled={!text || !!busy}>{busy === 'pdf' ? 'PDF 만드는 중…' : 'PDF 저장'}</button>
            {locked ? (
              <button type="button" className="btn secondary" onClick={unconfirm} disabled={!!busy}>확정 취소</button>
            ) : (
              <>
                <button type="button" className="btn secondary" onClick={() => save('임시')} disabled={!text || !!busy}>임시 저장</button>
                <button type="button" className="btn ok" onClick={() => save('확정')} disabled={!text || !!busy}>확정</button>
              </>
            )}
          </span>
        </>
      )}>
      <div className="stack">
        <div className="cluster">
          <button type="button" className="btn secondary sm" onClick={regenerate} disabled={locked || !!busy}>{busy === 'basic' ? '만드는 중…' : '기본 보고서로 다시 만들기'}</button>
          <button type="button" className="btn secondary sm" onClick={regenerateAi} disabled={locked || !!busy}>{busy === 'ai' ? 'AI 분석 중… (최대 1분)' : 'AI 분석 포함으로 다시 만들기'}</button>
          {locked ? <span className="hint">확정본은 고칠 수 없습니다. 고치려면 확정을 취소하세요.</span> : null}
        </div>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <textarea value={text} onChange={(e) => setText(e.target.value)} readOnly={locked} rows={18} aria-label="보고서 내용" className="report-editor" />
      </div>
    </Modal>
  );
}

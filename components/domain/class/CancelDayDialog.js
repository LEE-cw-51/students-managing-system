'use client';

import Link from 'next/link';
import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Field from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/client-api';
import { formatDate } from '@/lib/format';

/**
 * Cancel one meeting day of a class. When that day had a plan, the second step asks what to do
 * with it: re-split the remaining plan (onReplan) or leave it for later.
 */
export default function CancelDayDialog({ classId, className, date, onClose, onDone, onReplan }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await api('cancelClassDate', { class_id: classId, date, reason });
      toast(`${formatDate(date)} 휴강으로 지정했습니다.`);
      onDone(res);
      if (res.plan) setResult(res);
      else onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    const month = date.slice(0, 7);
    return (
      <Modal title="휴강한 날의 계획" onClose={onClose}>
        <div className="stack">
          <p style={{ margin: 0 }}>이 날에는 <strong>{result.plan.title || '계획'}</strong> 수업이 잡혀 있었습니다. 어떻게 할까요?</p>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>다시 나누기: 남은 수업일에 단원을 다시 배정한 초안을 만들고, 비교해서 확정합니다.</li>
            <li>보강일로 옮기기: 강의 계획 탭에서 반 보강을 잡은 뒤 이 날 계획의 ‘옮기기’를 누르세요.</li>
          </ul>
          <div className="form-actions">
            <button type="button" className="btn secondary" onClick={onClose}>그대로 두기</button>
            {onReplan ? (
              <button type="button" className="btn" onClick={() => { onReplan(month); onClose(); }}>남은 계획 다시 나누기</button>
            ) : (
              <Link className="btn" href={`/classes/${classId}?tab=plans`}>강의 계획에서 정리하기</Link>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`${className ? className + ' · ' : ''}${formatDate(date)} 휴강`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>이 날은 수업일에서 빠집니다. 숙제 확인은 직전 수업일 숙제로 이어지고, 언제든 휴강을 취소할 수 있습니다.</p>
        <Field label="사유 (선택)">{(id) => <input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 추석 연휴" maxLength={200} />}</Field>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>닫기</button>
          <button type="submit" className="btn danger" disabled={saving}>{saving ? '처리 중…' : '휴강으로 지정'}</button>
        </div>
      </form>
    </Modal>
  );
}

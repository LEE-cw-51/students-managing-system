'use client';

import Link from 'next/link';
import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Field from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/client-api';
import { formatDate } from '@/lib/format';

/**
 * Cancel one meeting day of a class. When that day had a plan, the second step offers to make a
 * new draft (onReplan) so the remaining days — whole-class makeups included — absorb it.
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
          <p style={{ margin: 0 }}>이 날에는 <strong>{result.plan.title || '계획'}</strong> 수업이 잡혀 있었습니다.</p>
          <p className="muted" style={{ margin: 0 }}>초안을 다시 만들면 남은 수업일(반 보강 포함)에 다시 나눕니다. 보강을 잡을 거라면 오늘 화면의 ‘보강 추가’로 반 보강을 먼저 잡은 뒤 다시 만드세요.</p>
          <div className="form-actions">
            <button type="button" className="btn secondary" onClick={onClose}>그대로 두기</button>
            {onReplan ? (
              <button type="button" className="btn" onClick={() => { onReplan(month); onClose(); }}>초안 다시 만들기</button>
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

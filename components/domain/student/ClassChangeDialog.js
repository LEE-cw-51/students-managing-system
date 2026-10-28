'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Field from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api } from '@/lib/client-api';
import { formatDate } from '@/lib/format';
import { useConfirm } from '@/components/ui/ConfirmDialog';

function addDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Regular classes that are running, for "어느 반으로" pickers. */
export function openRegularClasses(boot, exceptIds = []) {
  return (boot.search.classes || []).filter((c) => c.status === '운영' && c.class_type !== '시험대비' && !exceptIds.includes(c.id));
}

/**
 * One student's one class assignment: move to another class, take out of the class (they keep
 * their records and become 미배정 if no class is left), or delete an assignment made by mistake.
 */
export default function ClassChangeDialog({ studentId, studentName, rel, onClose, onDone }) {
  const confirm = useConfirm();
  const boot = useBoot();
  const toast = useToast();
  const [mode, setMode] = useState('move');
  const [target, setTarget] = useState('');
  // Moving starts today; taking out ends yesterday so the student leaves today's roster right away.
  const outDefault = rel.start_date && addDays(boot.today, -1) < rel.start_date ? boot.today : addDays(boot.today, -1);
  const [moveDate, setMoveDate] = useState(boot.today);
  const [outDate, setOutDate] = useState(outDefault);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const targets = openRegularClasses(boot, [rel.class_id]);
  const date = mode === 'out' ? outDate : moveDate;
  const setDate = mode === 'out' ? setOutDate : setMoveDate;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'move' && !target) return setError('옮겨 갈 반을 골라 주세요.');
    if (mode === 'delete' && !(await confirm({ message: `${studentName} 학생의 ${rel.class_name} 배정을 지울까요? 배정 이력에서도 사라집니다.`, confirmLabel: '배정 지우기', danger: true }))) return;
    setSaving(true);
    try {
      if (mode === 'move') {
        await api('moveStudent', { student_id: studentId, class_id: target, start_date: date, from_rel_id: rel.rel_id });
        toast(`${studentName} 학생을 ${targets.find((c) => c.id === target).name}으로 옮겼습니다.`);
      } else if (mode === 'out') {
        await api('closeStudentClass', { id: rel.rel_id, end_date: date });
        toast(`${studentName} 학생을 ${rel.class_name}에서 뺐습니다.`);
      } else {
        await api('removeStudentClass', { id: rel.rel_id });
        toast('배정을 지웠습니다.');
      }
      boot.refresh();
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`${studentName} · ${rel.class_name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="segmented" role="group" aria-label="바꿀 내용">
          <button type="button" aria-pressed={mode === 'move'} onClick={() => setMode('move')}>다른 반으로 이동</button>
          <button type="button" aria-pressed={mode === 'out'} onClick={() => setMode('out')}>반에서 빼기</button>
          <button type="button" aria-pressed={mode === 'delete'} onClick={() => setMode('delete')}>배정 삭제</button>
        </div>
        {mode === 'move' ? (
          <div className="form-grid">
            <Field label="옮겨 갈 반">{(id) => (
              <select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">반 선택</option>
                {targets.map((c) => <option key={c.id} value={c.id}>{c.name}{c.schedule_label ? ` · ${c.schedule_label}` : ''}</option>)}
              </select>
            )}</Field>
            <Field label="이동일" hint={`이 날부터 새 반 명단에 들어갑니다. ${rel.class_name}은 전날까지입니다.`}>
              {(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
          </div>
        ) : null}
        {mode === 'out' ? (
          <Field label="마지막 수업일" hint="이 날까지 명단에 남고 기록은 그대로입니다. 다른 반이 없으면 미배정이 됩니다.">
            {(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
        ) : null}
        {mode === 'delete' ? (
          rel.removable
            ? <p style={{ margin: 0 }}>잘못 넣은 배정을 아예 지웁니다({rel.start_date ? `${formatDate(rel.start_date)} 시작` : ''}). 이 반에 수업 기록이 없어 지워도 남는 기록이 없습니다.</p>
            : <div className="notice-bar">이 반에 수업 기록이나 숙제 체크가 있어 지울 수 없습니다. ‘반에서 빼기’를 쓰면 기록은 남고 명단에서만 빠집니다.</div>
        ) : null}
        {error ? <div className="error-box prewrap" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className={'btn' + (mode === 'move' ? '' : ' danger')} disabled={saving || (mode === 'delete' && !rel.removable)}>
            {saving ? '처리 중…' : mode === 'move' ? '이동' : mode === 'out' ? '반에서 빼기' : '배정 삭제'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

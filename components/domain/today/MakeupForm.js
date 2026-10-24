'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Field from '@/components/ui/Field';
import TimeInput from '@/components/ui/TimeInput';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api } from '@/lib/client-api';

/** Schedule a class or student makeup. Times are typed as numbers (1500 → 15:00). */
export default function MakeupForm({ date, onClose, onSaved }) {
  const boot = useBoot();
  const toast = useToast();
  const [form, setForm] = useState({ kind: '반', makeup_date: date, start_time: '', end_time: '', class_id: '', student_ids: [], title: '', memo: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const set = (key, v) => setForm((f) => ({ ...f, [key]: v }));
  const classes = (boot.search.classes || []).filter((c) => c.status === '운영');
  const students = (boot.search.students || []).filter((s) => s.status === '재원' && (!filter || s.name.includes(filter)));

  const toggleStudent = (id) => set('student_ids', form.student_ids.includes(id) ? form.student_ids.filter((x) => x !== id) : [...form.student_ids, id]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('saveMakeupSession', { ...form, status: '예정' });
      toast('보강을 등록했습니다.');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="보강 추가" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="segmented" role="group" aria-label="보강 종류">
          {[['반', '반 보강'], ['학생', '학생 보강']].map(([k, l]) => <button key={k} type="button" aria-pressed={form.kind === k} onClick={() => set('kind', k)}>{l}</button>)}
        </div>
        <div className="form-grid">
          <Field label="날짜">{(id) => <input id={id} type="date" value={form.makeup_date} onChange={(e) => set('makeup_date', e.target.value)} />}</Field>
          <Field label="시간" hint="숫자로 입력 (1500 → 15:00)">{() => (
            <div className="cluster">
              <TimeInput value={form.start_time} label="시작 시간" onChange={(t) => set('start_time', t)} />
              <span aria-hidden="true">~</span>
              <TimeInput value={form.end_time} label="종료 시간" onChange={(t) => set('end_time', t)} />
            </div>
          )}</Field>
          <Field label={form.kind === '반' ? '반' : '반 (선택)'}>{(id) => (
            <select id={id} value={form.class_id} onChange={(e) => set('class_id', e.target.value)}>
              <option value="">{form.kind === '반' ? '선택' : '없음'}</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}</Field>
          <Field label="제목 (선택)">{(id) => <input id={id} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="예: 추석 휴강 보강" />}</Field>
        </div>
        {form.kind === '학생' ? (
          <Field label={`학생 (${form.student_ids.length}명 선택)`}>{(id) => (
            <>
              <input id={id} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="이름으로 찾기" />
              <div className="roster-chips" style={{ marginTop: 8, maxHeight: 160, overflow: 'auto' }}>
                {students.map((s) => (
                  <button key={s.id} type="button" className={'tag ' + (form.student_ids.includes(s.id) ? '' : 'muted')} style={{ padding: '6px 10px' }}
                    aria-pressed={form.student_ids.includes(s.id)} onClick={() => toggleStudent(s.id)}>{form.student_ids.includes(s.id) ? '✓ ' : ''}{s.name}</button>
                ))}
              </div>
            </>
          )}</Field>
        ) : null}
        <Field label="메모">{(id) => <textarea id={id} rows={2} value={form.memo} onChange={(e) => set('memo', e.target.value)} />}</Field>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : '등록'}</button>
        </div>
      </form>
    </Modal>
  );
}

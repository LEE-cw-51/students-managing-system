'use client';

import { useEffect, useState } from 'react';
import Modal, { ModalCancel } from '@/components/ui/Modal';
import { useDirty } from '@/components/ui/useDirty';
import Field from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/client-api';
import { formatDate } from '@/lib/format';

const FIELDS = ['progress', 'content', 'test_title', 'test_max_score', 'test_difficulty', 'test_scope', 'class_notice', 'memo'];

/** Edit the class-level record of one lesson date (진도·수업 내용·테스트·공지). */
export default function SessionEditor({ classId, date, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [loads, setLoads] = useState(0);
  const dirty = useDirty(form, loads);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('getClassSession', date, classId)
      .then((s) => {
        setForm(Object.fromEntries(FIELDS.map((k) => [k, s[k] === null || s[k] === undefined ? '' : String(s[k])])));
        setLoads((n) => n + 1);
      })
      .catch((e) => setError(e.message));
  }, [classId, date]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('saveClassSession', { lesson_date: date, class_id: classId, ...form });
      toast('수업 기록을 저장했습니다.');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`${formatDate(date)} 수업 기록`} onClose={onClose} dirty={dirty}>
      {!form ? (error ? <div className="error-box">{error}</div> : <div className="loading"><span className="spinner" />불러오는 중…</div>) : (
        <form onSubmit={submit} className="stack">
          <div className="form-grid">
            <Field label="진도" wide hint="학생 일일 보고서의 ‘학습 진도’로 들어갑니다.">{(id) => <textarea id={id} rows={2} value={form.progress} onChange={set('progress')} />}</Field>
            <Field label="수업 내용" wide>{(id) => <textarea id={id} rows={3} value={form.content} onChange={set('content')} />}</Field>
            <Field label="테스트 이름">{(id) => <input id={id} value={form.test_title} onChange={set('test_title')} placeholder="예: 단원 확인 테스트" />}</Field>
            <Field label="만점">{(id) => <input id={id} inputMode="numeric" value={form.test_max_score} onChange={set('test_max_score')} />}</Field>
            <Field label="난이도">{(id) => (
              <select id={id} value={form.test_difficulty} onChange={set('test_difficulty')}>
                <option value="">-</option><option>상</option><option>중</option><option>하</option>
              </select>
            )}</Field>
            <Field label="시험 범위" wide hint="일일 보고서와 학생 기록에 들어갑니다.">{(id) => <input id={id} value={form.test_scope} onChange={set('test_scope')} placeholder="예: 3단원 함수 ~ 4단원" />}</Field>
            <Field label="반 공지" wide hint="이 날짜 일일 보고서의 공지사항으로 들어갑니다.">{(id) => <textarea id={id} rows={2} value={form.class_notice} onChange={set('class_notice')} />}</Field>
            <Field label="메모 (보고서에 들어가지 않음)" wide>{(id) => <textarea id={id} rows={2} value={form.memo} onChange={set('memo')} />}</Field>
          </div>
          {error ? <div className="error-box" role="alert">{error}</div> : null}
          <div className="form-actions">
            <ModalCancel />
            <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

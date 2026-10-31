'use client';

import { useEffect, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Field from '@/components/ui/Field';
import Modal from '@/components/ui/Modal';
import { Async } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';

const SECTIONS = [
  {
    title: '학원 정보',
    hint: '사이드바와 보고서·PDF 머리말에 들어갑니다.',
    fields: [['academy_name', '학원명'], ['teacher_name', '담당 강사명'], ['contact', '연락처']]
  },
  {
    title: '보고서 문구',
    hint: '일일·월간 보고서의 처음과 끝에 들어갑니다.',
    fields: [['report_greeting', '인사말'], ['report_closing', '맺음말', true]]
  },
  {
    title: '과제 이행 등급 기준',
    hint: '보고서에 등급과 함께 표시되는 설명입니다. 항목 등급 A 100, B 89, C 79, D 69, E 59, F 50을 평균 내 A 90점 이상, B 80점 이상, C 70점 이상, D 60점 이상, E 51점 이상, 그 아래는 F로 바꿉니다.',
    fields: [['assignment_A', 'A 기준'], ['assignment_B', 'B 기준'], ['assignment_C', 'C 기준'], ['assignment_D', 'D 기준'], ['assignment_E', 'E 기준'], ['assignment_F', 'F 기준']]
  }
];

function PromotionModal({ onClose, onDone }) {
  const toast = useToast();
  const state = useApi(() => api('previewGradePromotion'), []);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await api('promoteGrades');
      toast(`${res.updated_count}명의 학년을 올렸습니다.`);
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="학년 올리기 (새 학년도)" onClose={onClose}
      footer={<><button type="button" className="btn secondary" onClick={onClose}>취소</button><button type="button" className="btn" disabled={busy || !state.data || !state.data.total} onClick={run}>{busy ? '처리 중…' : '학년 올리기'}</button></>}>
      <Async state={state}>
        {(d) => (
          <div className="stack-sm">
            <p style={{ margin: 0 }}>재원생 <strong>{d.total}명</strong>의 학년을 한 단계씩 올립니다. 되돌리려면 학생 정보에서 직접 고쳐야 합니다.</p>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>지금</th><th>바뀐 후</th><th className="num">학생 수</th></tr></thead>
                <tbody>
                  {d.items.filter((i) => i.count).map((i) => <tr key={i.from_grade}><td>{i.from_grade}</td><td>{i.to_grade}</td><td className="num">{i.count}명</td></tr>)}
                </tbody>
              </table>
            </div>
            {d.skipped.length ? <p className="hint" style={{ margin: 0 }}>고3·기타 학년 {d.skipped.length}명은 그대로 둡니다: {d.skipped.map((s) => s.name).join(', ')}</p> : null}
          </div>
        )}
      </Async>
    </Modal>
  );
}

export default function SettingsPage() {
  const boot = useBoot();
  const toast = useToast();
  const [form, setForm] = useState(boot.settings || {});
  const [saved, setSaved] = useState(JSON.stringify(boot.settings || {}));
  const [saving, setSaving] = useState(false);
  const [promoting, setPromoting] = useState(false);
  useEffect(() => {
    setForm(boot.settings || {});
    setSaved(JSON.stringify(boot.settings || {}));
  }, [boot.settings]);
  const dirty = JSON.stringify(form) !== saved;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const keys = SECTIONS.flatMap((s) => s.fields.map((f) => f[0]));
      const next = await api('saveSettings', Object.fromEntries(keys.map((k) => [k, form[k] || ''])));
      setSaved(JSON.stringify(next));
      toast('설정을 저장했습니다.');
      boot.refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="설정" />
      <div className="stack">
        {SECTIONS.map((sec) => (
          <section key={sec.title} className="card">
            <h2>{sec.title}</h2>
            <p className="hint" style={{ marginTop: -6 }}>{sec.hint}</p>
            <div className="form-grid">
              {sec.fields.map(([key, label, area]) => (
                <Field key={key} label={label} wide={!!area}>
                  {(id) => area
                    ? <textarea id={id} rows={3} value={form[key] || ''} onChange={set(key)} />
                    : <input id={id} value={form[key] || ''} onChange={set(key)} />}
                </Field>
              ))}
            </div>
          </section>
        ))}
        <section className="card">
          <h2>새 학년도 준비</h2>
          <div className="split">
            <span className="muted">3월에 한 번, 재원생 학년을 한 단계씩 올립니다(중2 → 중3). 미리 보기에서 확인한 뒤 적용합니다.</span>
            <button type="button" className="btn secondary" onClick={() => setPromoting(true)}>학년 올리기…</button>
          </div>
        </section>
        <div className="save-bar">
          <span className={'save-state ' + (dirty ? 'dirty' : '')}>{dirty ? '● 저장하지 않은 변경이 있습니다' : '저장됨'}</span>
          <button type="button" className="btn" disabled={!dirty || saving} onClick={save}>{saving ? '저장 중…' : '설정 저장'}</button>
        </div>
      </div>
      {promoting ? <PromotionModal onClose={() => setPromoting(false)} onDone={() => { setPromoting(false); boot.refresh(); }} /> : null}
    </>
  );
}

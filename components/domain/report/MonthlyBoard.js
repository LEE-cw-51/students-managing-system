'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Async, EmptyState, Kpi } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import MonthlyEditor from './MonthlyEditor';
import { api, useApi } from '@/lib/client-api';
import { generateMonthlyAi, runLimited } from '@/lib/report-client';

const STATUS_TAG = { 미작성: 'warn', 임시: 'amber', 확정: 'ok' };

export default function MonthlyBoard({ ym, classId, onChange }) {
  const boot = useBoot();
  const toast = useToast();
  const [y, m] = ym.split('-').map(Number);
  const state = useApi(() => api('getMonthlyReportBoard', classId, y, m), [classId, ym]);
  const [selected, setSelected] = useState(() => new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [jobs, setJobs] = useState({});
  const [running, setRunning] = useState('');
  const [editing, setEditing] = useState(null);
  const [setupError, setSetupError] = useState('');
  const classes = (boot.search.classes || []).filter((c) => c.status === '운영');
  const rows = useMemo(() => (state.data ? state.data.rows : []), [state.data]);

  const eligible = (r) => r.status !== '확정' && (overwrite || r.status === '미작성') && r.lesson_count > 0;
  const targets = rows.filter((r) => selected.has(r.student_id) && eligible(r));
  const toggleAll = (on) => setSelected(on ? new Set(rows.filter(eligible).map((r) => r.student_id)) : new Set());
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const runBasic = async () => {
    setRunning('basic');
    setJobs(Object.fromEntries(targets.map((r) => [r.student_id, { state: 'running' }])));
    try {
      const res = await api('generateMonthlyReportsBulk', targets.map((r) => r.student_id), y, m, { overwrite });
      setJobs(Object.fromEntries(res.map((x) => [x.student_id, { state: x.result === 'created' ? 'done' : x.result === 'failed' ? 'failed' : 'skipped', note: x.reason }])));
      toast(`${res.filter((x) => x.result === 'created').length}명 보고서를 만들었습니다.`);
    } catch (e) {
      toast(e.message, 'error');
      setJobs({});
    } finally {
      setRunning('');
      setSelected(new Set());
      state.reload();
    }
  };

  const runAi = async (list) => {
    setRunning('ai');
    setSetupError('');
    setJobs((j) => ({ ...j, ...Object.fromEntries(list.map((r) => [r.student_id, { state: 'queued' }])) }));
    let ok = 0;
    let stopped = '';
    await runLimited(list, 2, async (r) => {
      // A missing key fails every student the same way: stop at the first one.
      if (stopped) throw new Error(stopped);
      setJobs((j) => ({ ...j, [r.student_id]: { state: 'running' } }));
      const d = await generateMonthlyAi(r.student_id, y, m);
      await api('saveMonthlyReport', { student_id: r.student_id, year: y, month: m, report_text: d.text, status: '임시' });
    }, (r, result) => {
      if (result.ok) ok += 1;
      if (!result.ok && /설정되지 않았습니다/.test(result.error)) stopped = result.error;
      setJobs((j) => ({ ...j, [r.student_id]: result.ok ? { state: 'done' } : stopped ? { state: 'skipped', note: 'AI 설정 필요' } : { state: 'failed', note: result.error } }));
    });
    setRunning('');
    setSelected(new Set());
    if (stopped) {
      setSetupError(stopped);
    } else {
      toast(`AI 보고서 ${ok}/${list.length}명 완료`, ok === list.length ? 'ok' : 'error');
    }
    state.reload();
  };

  const failed = rows.filter((r) => jobs[r.student_id] && jobs[r.student_id].state === 'failed');
  const doneCount = Object.values(jobs).filter((j) => j.state === 'done' || j.state === 'failed' || j.state === 'skipped').length;
  const totalJobs = Object.keys(jobs).length;

  return (
    <div className="stack">
      <div className="cluster">
        <input type="month" value={ym} onChange={(e) => e.target.value && onChange({ month: e.target.value })} aria-label="월" style={{ width: 'auto' }} />
        <select value={classId} onChange={(e) => { setSelected(new Set()); setJobs({}); onChange({ class: e.target.value }); }} aria-label="반" style={{ width: 'auto' }}>
          <option value="">전체 재원생</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <Async state={state}>
        {(d) => (
          <>
            <div className="kpis">
              <Kpi label="학생" value={`${d.rows.length}명`} />
              <Kpi label="미작성" value={d.counts.none} tone={d.counts.none ? 'terracotta' : undefined} />
              <Kpi label="임시 저장" value={d.counts.draft} />
              <Kpi label="확정" value={d.counts.final} tone="green" />
            </div>
            <div className="bulk-bar card">
              <span className="cluster">
                <strong>선택 {targets.length}명</strong>
                <label className="check-label" style={{ fontWeight: 500 }}>
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> 임시 저장된 보고서도 다시 만들기
                </label>
                <span className="muted">확정된 보고서는 건드리지 않습니다.</span>
              </span>
              <span className="cluster">
                <button type="button" className="btn secondary" disabled={!targets.length || !!running} onClick={runBasic}>{running === 'basic' ? '만드는 중…' : '기본 보고서 일괄 생성'}</button>
                <button type="button" className="btn" disabled={!targets.length || !!running} onClick={() => runAi(targets)}>{running === 'ai' ? `AI 생성 중 ${doneCount}/${totalJobs}` : 'AI 분석 포함 일괄 생성'}</button>
              </span>
            </div>
            {running === 'ai' ? <div className="progress" role="progressbar" aria-valuenow={doneCount} aria-valuemax={totalJobs}><span style={{ width: `${totalJobs ? (doneCount / totalJobs) * 100 : 0}%` }} /></div> : null}
            {setupError ? <div className="error-box" role="alert">AI 보고서를 만들 수 없습니다: {setupError} 기본 보고서는 그대로 만들 수 있습니다.</div> : null}
            {failed.length && !running ? (
              <div className="error-box">실패 {failed.length}명: {failed.map((r) => `${r.name}(${jobs[r.student_id].note})`).join(', ')}{' '}
                <button type="button" className="link-btn" onClick={() => runAi(failed)}>실패한 학생만 AI 다시 시도</button>
              </div>
            ) : null}
            {d.rows.length ? (
              <div className="table-wrap">
                <table className="data-table stack-mobile">
                  <thead>
                    <tr>
                      <th className="center"><input type="checkbox" aria-label="전체 선택" style={{ width: 18, minHeight: 0 }}
                        checked={rows.filter(eligible).length > 0 && rows.filter(eligible).every((r) => selected.has(r.student_id))}
                        onChange={(e) => toggleAll(e.target.checked)} /></th>
                      <th>학생</th><th className="num">이 달 수업</th><th>상태</th><th>내용 미리보기</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => {
                      const job = jobs[r.student_id];
                      return (
                        <tr key={r.student_id}>
                          <td className="center"><input type="checkbox" aria-label={`${r.name} 선택`} style={{ width: 18, minHeight: 0 }} disabled={!eligible(r)} checked={selected.has(r.student_id)} onChange={() => toggle(r.student_id)} /></td>
                          <td className="primary"><Link href={`/students/${r.student_id}?tab=reports`}>{r.name}</Link> <span className="muted">{r.grade}</span></td>
                          <td data-label="이 달 수업" className="num">{r.lesson_count ? `${r.lesson_count}회` : <span className="muted">없음</span>}</td>
                          <td data-label="상태">
                            <span className={'tag ' + STATUS_TAG[r.status]}>{r.status}</span>
                            {job ? <span className={'tag ' + (job.state === 'done' ? 'ok' : job.state === 'failed' ? 'danger' : 'muted')} style={{ marginLeft: 4 }} title={job.note || ''}>
                              {{ queued: '대기', running: '생성 중…', done: '완료', failed: '실패', skipped: `건너뜀${job.note ? `(${job.note})` : ''}` }[job.state]}
                            </span> : null}
                          </td>
                          <td data-label="미리보기" className="muted">{r.preview ? `${r.preview}…` : '-'}</td>
                          <td><button type="button" className="btn secondary sm" disabled={!!running} onClick={() => setEditing(r)}>{r.status === '미작성' ? '작성' : '열기'}</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div className="card"><EmptyState title="이 달 대상 학생이 없습니다" /></div>}
          </>
        )}
      </Async>
      {editing ? <MonthlyEditor row={editing} year={y} month={m} onClose={() => setEditing(null)}
        onSaved={() => { setJobs((j) => { const n = { ...j }; delete n[editing.student_id]; return n; }); state.reload(); }} /> : null}
    </div>
  );
}

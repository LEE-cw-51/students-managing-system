'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { SelectAllCheckbox, useSelection } from '@/components/ui/useSelection';
import MonthlyEditor, { STATUS_TAG } from './MonthlyEditor';
import { api, useApi } from '@/lib/client-api';
import { shortDate } from '@/lib/format';
import { downloadMonthlyPdf, generateMonthlyAi, runLimited } from '@/lib/report-client';

const FILTERS = [['', '전체'], ['미작성', '미작성'], ['임시', '임시'], ['확정', '확정']];
const JOB_LABEL = { queued: '대기', running: '진행 중…', done: '완료', failed: '실패' };
const RUN_LABEL = { basic: '기본 보고서 만드는 중', ai: 'AI 보고서 만드는 중', confirm: '확정하는 중', undo: '되돌리는 중', pdf: 'PDF 내려받는 중' };

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(y, m - 1 + delta, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

/** The saved text of a monthly report, read without regenerating it. */
async function savedText(r, y, m) {
  const d = await api('generateMonthlyReport', r.student_id, y, m);
  if (!d.existing || !d.existing.report_text) throw new Error('저장된 보고서가 없습니다');
  return { text: d.existing.report_text, status: String(d.existing.status || '임시') };
}

export default function MonthlyBoard({ ym, classId, onChange, head }) {
  const boot = useBoot();
  const toast = useToast();
  const confirm = useConfirm();
  const [y, m] = ym.split('-').map(Number);
  const state = useApi(() => api('getMonthlyReportBoard', classId, y, m), [classId, ym]);
  const [filter, setFilter] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [jobs, setJobs] = useState({});
  const [running, setRunning] = useState('');
  const [lastRun, setLastRun] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [editing, setEditing] = useState(null);
  const [setupError, setSetupError] = useState('');
  const stop = useRef(false);
  const classes = (boot.search.classes || []).filter((c) => c.status === '운영' || c.id === classId);
  const rows = useMemo(() => (state.data ? state.data.rows : []), [state.data]);
  const visible = useMemo(() => (filter ? rows.filter((r) => r.status === filter) : rows), [rows, filter]);
  const sel = useSelection(visible.map((r) => r.student_id));
  const chosen = visible.filter((r) => sel.selected.has(r.student_id));

  const genTargets = chosen.filter((r) => r.status !== '확정' && (overwrite || r.status === '미작성') && r.lesson_count > 0);
  const confirmTargets = chosen.filter((r) => r.status === '임시');
  const pdfTargets = chosen.filter((r) => r.status !== '미작성');
  const counts = state.data ? { '': rows.length, 미작성: state.data.counts.none, 임시: state.data.counts.draft, 확정: state.data.counts.final } : {};

  const reset = () => { sel.clear(); setJobs({}); setSetupError(''); };
  const mark = (list, job) => setJobs((j) => ({ ...j, ...Object.fromEntries(list.map((r) => [r.student_id, job])) }));
  const begin = (kind, list) => {
    stop.current = false;
    setRunning(kind);
    setLastRun(kind);
    setProgress({ done: 0, total: list.length });
    mark(list, { state: 'queued' });
  };
  const finish = () => {
    setRunning('');
    sel.clear();
    state.reload();
  };
  const okToOverwrite = async (list) => {
    const drafts = list.filter((r) => r.status === '임시').length;
    return !drafts || confirm({ message: `임시 저장된 보고서 ${drafts}명의 본문을 새로 만든 내용으로 바꿉니다. 바꾼 뒤에는 되돌릴 수 없습니다.`, confirmLabel: '다시 만들기', danger: true });
  };

  /** Runs `job` per row two at a time; "중지" skips the rows not started yet. */
  const runEach = async (list, limit, job) => {
    const done = [];
    let failed = 0;
    await runLimited(list, limit, async (r) => {
      if (stop.current) throw new Error('중지됨');
      setJobs((j) => ({ ...j, [r.student_id]: { state: 'running' } }));
      return job(r);
    }, (r, result) => {
      setProgress((p) => ({ ...p, done: p.done + 1 }));
      if (result.ok) done.push({ row: r, value: result.value });
      else if (result.error !== '중지됨') failed += 1;
      setJobs((j) => ({ ...j, [r.student_id]: result.ok ? { state: 'done' } : result.error === '중지됨' ? { state: 'skipped', note: '중지' } : { state: 'failed', note: result.error } }));
    });
    return { done, failed, stopped: stop.current };
  };

  const runBasic = async () => {
    const list = genTargets;
    if (overwrite && !(await okToOverwrite(list))) return;
    begin('basic', list);
    mark(list, { state: 'running' });
    try {
      const res = await api('generateMonthlyReportsBulk', list.map((r) => r.student_id), y, m, { overwrite });
      setJobs(Object.fromEntries(res.map((x) => [x.student_id, { state: x.result === 'created' ? 'done' : x.result === 'failed' ? 'failed' : 'skipped', note: x.reason }])));
      setProgress({ done: list.length, total: list.length });
      toast(`${res.filter((x) => x.result === 'created').length}명 보고서를 만들었습니다.`);
    } catch (e) {
      toast(e.message, 'error');
      setJobs({});
    } finally {
      finish();
    }
  };

  const runAi = async (list, ask = true) => {
    if (ask && overwrite && !(await okToOverwrite(list))) return;
    setSetupError('');
    begin('ai', list);
    let missingKey = '';
    const { done, stopped } = await runEach(list, 2, async (r) => {
      if (missingKey) throw new Error(missingKey);
      try {
        const d = await generateMonthlyAi(r.student_id, y, m);
        await api('saveMonthlyReport', { student_id: r.student_id, year: y, month: m, report_text: d.text, status: '임시' });
      } catch (e) {
        if (/설정되지 않았습니다/.test(e.message)) missingKey = e.message;
        throw e;
      }
    });
    finish();
    if (missingKey) {
      setSetupError(missingKey);
      mark(list.filter((r) => !done.some((x) => x.row.student_id === r.student_id)), { state: 'skipped', note: 'AI 설정 필요' });
    } else {
      toast(`AI 보고서 ${done.length}/${list.length}명 완료${stopped ? ' (중지)' : ''}`, done.length === list.length ? 'ok' : 'error');
    }
  };

  const undoConfirm = async (done) => {
    begin('undo', done.map((x) => x.row));
    const res = await runEach(done.map((x) => x.row), 2, (r) => api('saveMonthlyReport', {
      student_id: r.student_id, year: y, month: m, report_text: done.find((x) => x.row.student_id === r.student_id).value, status: '임시'
    }));
    finish();
    toast(res.failed ? `${res.done.length}명만 임시로 되돌렸습니다. ${res.failed}명은 실패했습니다.` : `${res.done.length}명을 임시로 되돌렸습니다.`, res.failed ? 'error' : 'ok');
  };

  const runConfirm = async () => {
    const list = confirmTargets;
    begin('confirm', list);
    const { done, failed, stopped } = await runEach(list, 2, async (r) => {
      const saved = await savedText(r, y, m);
      if (saved.status !== '임시') throw new Error(`이미 ${saved.status}`);
      await api('saveMonthlyReport', { student_id: r.student_id, year: y, month: m, report_text: saved.text, status: '확정' });
      return saved.text;
    });
    finish();
    const msg = `${done.length}명 확정했습니다.${failed ? ` ${failed}명 실패.` : ''}${stopped ? ' (중지)' : ''}`;
    if (done.length) toast(msg, failed ? 'error' : 'ok', { duration: 5000, action: { label: '되돌리기', onClick: () => undoConfirm(done) } });
    else toast(msg, 'error');
  };

  const runPdf = async () => {
    const list = pdfTargets;
    begin('pdf', list);
    const { done, failed, stopped } = await runEach(list, 1, async (r) => {
      const saved = await savedText(r, y, m);
      await downloadMonthlyPdf(r.student_id, y, m, saved.text, r.name);
    });
    finish();
    toast(`PDF ${done.length}/${list.length}개 내려받았습니다.${stopped ? ' (중지)' : ''}`, failed ? 'error' : 'ok');
  };

  const failedRows = rows.filter((r) => jobs[r.student_id] && jobs[r.student_id].state === 'failed');
  const label = classId ? (classes.find((c) => c.id === classId) || {}).name || '반' : '전체 재원생';
  const editIndex = editing ? editing.list.findIndex((r) => r.student_id === editing.id) : -1;
  const editRow = editIndex >= 0 ? editing.list[editIndex] : null;

  return (
    <>
      {head(`${y}년 ${m}월 · ${label}${state.data ? ` ${rows.length}명` : ''}`)}
      <div className="stack">
        <div className="rp-filters">
          <span className="rp-pick">
            <button type="button" className="btn secondary sm rp-step" aria-label="지난달" disabled={!!running} onClick={() => { reset(); onChange({ month: shiftMonth(ym, -1) }); }}>◀</button>
            <input type="month" value={ym} disabled={!!running} onChange={(e) => { if (e.target.value) { reset(); onChange({ month: e.target.value }); } }} aria-label="월" />
            <button type="button" className="btn secondary sm rp-step" aria-label="다음 달" disabled={!!running} onClick={() => { reset(); onChange({ month: shiftMonth(ym, 1) }); }}>▶</button>
            <select value={classId} disabled={!!running} onChange={(e) => { reset(); onChange({ mclass: e.target.value }); }} aria-label="반">
              <option value="">전체 재원생</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </span>
          <div className="segmented rp-status" role="group" aria-label="보고서 상태">
            {FILTERS.map(([v, text]) => (
              <button key={text} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)}>
                {text}{state.data ? <span className="cls-count"> {counts[v]}</span> : null}
              </button>
            ))}
          </div>
        </div>
        {chosen.length || running ? (
          <div className="card bulk-bar rp-bulk">
            <div className="rp-bulk-row">
              <span className="cluster">
                <strong>선택 {chosen.length}명</strong>
                <button type="button" className="btn ghost sm" onClick={sel.clear} disabled={!!running}>선택 해제</button>
              </span>
              <span className="cluster">
                <button type="button" className="btn secondary sm" disabled={!genTargets.length || !!running} onClick={runBasic}>기본 생성 ({genTargets.length})</button>
                <button type="button" className="btn secondary sm" disabled={!genTargets.length || !!running} onClick={() => runAi(genTargets)}>AI 생성 ({genTargets.length})</button>
                <label className="check-label rp-overwrite">
                  <input type="checkbox" checked={overwrite} disabled={!!running} onChange={(e) => setOverwrite(e.target.checked)} /> 임시도 다시 만들기
                </label>
              </span>
              <span className="cluster">
                <button type="button" className="btn ok sm" disabled={!confirmTargets.length || !!running} onClick={runConfirm}>일괄 확정 ({confirmTargets.length})</button>
                <button type="button" className="btn secondary sm rp-pdf" disabled={!pdfTargets.length || !!running} onClick={runPdf}>일괄 PDF ({pdfTargets.length})</button>
              </span>
            </div>
            {running ? (
              <div className="rp-progress">
                <span>{RUN_LABEL[running]} {progress.done}/{progress.total}</span>
                <div className="progress" role="progressbar" aria-label={RUN_LABEL[running]} aria-valuenow={progress.done} aria-valuemax={progress.total}>
                  <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                </div>
                {running !== 'basic' ? <button type="button" className="btn ghost sm" onClick={() => { stop.current = true; }}>중지</button> : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {setupError ? <div className="error-box" role="alert">AI 보고서를 만들 수 없습니다: {setupError} 기본 보고서는 그대로 만들 수 있습니다.</div> : null}
        {failedRows.length && !running ? (
          <div className="error-box">실패 {failedRows.length}명: {failedRows.map((r) => `${r.name}(${jobs[r.student_id].note})`).join(', ')}
            {lastRun === 'ai' ? <>{' '}<button type="button" className="link-btn" onClick={() => runAi(failedRows, false)}>실패한 학생만 AI 다시 시도</button></> : null}
          </div>
        ) : null}
        <Async state={state}>
          {() => visible.length ? (
            <div className="table-wrap rp-table">
              <table className="data-table stack-mobile">
                <thead>
                  <tr>
                    <th className="check-col"><SelectAllCheckbox sel={sel} label="보이는 학생 전체 선택" /></th>
                    <th>학생</th><th className="num">이 달 수업</th><th>상태</th><th>마지막 저장</th><th>내용 미리보기</th><th />
                  </tr>
                </thead>
                <tbody>
                  <tr className="rp-mobile-head">
                    <td>
                      <label className="rp-check"><SelectAllCheckbox sel={sel} label="보이는 학생 전체 선택" /> 전체 선택</label>
                      <span className="muted">{visible.length}명</span>
                    </td>
                  </tr>
                  {visible.map((r) => {
                    const job = jobs[r.student_id];
                    return (
                      <tr key={r.student_id}>
                        <td className="check-col rp-check-cell">
                          <label className="rp-check">
                            <span className="rp-check-label">선택</span>
                            <input type="checkbox" aria-label={`${r.name} 선택`} checked={sel.selected.has(r.student_id)} onChange={() => sel.toggle(r.student_id)} />
                          </label>
                        </td>
                        <td className="primary"><Link href={`/students/${r.student_id}?tab=counseling`}>{r.name}</Link> <span className="muted">{r.grade}</span></td>
                        <td data-label="이 달 수업" className="num">{r.lesson_count ? `${r.lesson_count}회` : <span className="muted">없음</span>}</td>
                        <td data-label="상태">
                          <span className="rp-tags">
                            <span className={'tag ' + STATUS_TAG[r.status]}>{r.status}</span>
                            {job ? (
                              <span className={'tag ' + (job.state === 'done' ? 'ok' : job.state === 'failed' ? 'danger' : 'muted')} title={job.note || ''}>
                                {job.state === 'skipped' ? `건너뜀${job.note ? `(${job.note})` : ''}` : JOB_LABEL[job.state]}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td data-label="마지막 저장" className={r.updated_at ? '' : 'muted empty-mobile'}>{r.updated_at ? shortDate(String(r.updated_at).slice(0, 10)) : '-'}</td>
                        <td data-label="미리보기" className={'muted rp-preview' + (r.preview ? '' : ' empty-mobile')}>{r.preview ? `${r.preview}…` : '-'}</td>
                        <td data-label="보고서" className="rp-action">
                          <button type="button" className="btn secondary sm" disabled={!!running} onClick={() => setEditing({ id: r.student_id, list: visible })}>{r.status === '미작성' ? '작성' : '열기'}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card">
              {rows.length ? <EmptyState title={`${filter} 보고서가 없습니다`}>다른 상태를 골라 보세요.</EmptyState> : <EmptyState title="이 달 대상 학생이 없습니다" />}
            </div>
          )}
        </Async>
      </div>
      {editRow ? (
        <MonthlyEditor row={editRow} year={y} month={m}
          prev={editing.list[editIndex - 1]} next={editing.list[editIndex + 1]}
          onNavigate={(r) => setEditing((e) => ({ ...e, id: r.student_id }))}
          onClose={() => setEditing(null)}
          onSaved={() => { setJobs((j) => { const n = { ...j }; delete n[editRow.student_id]; return n; }); state.reload(); }} />
      ) : null}
    </>
  );
}

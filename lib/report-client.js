'use client';

import { ApiError } from './client-api';

async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    throw new ApiError('서버에 연결할 수 없습니다.');
  }
  if (res.status === 401) {
    window.location.href = '/login';
    throw new ApiError('로그인이 필요합니다.');
  }
  return res;
}

/** Monthly report text with AI sections (runs outside the DB lock on the server). */
export async function generateMonthlyAi(studentId, year, month) {
  const res = await postJson('/api/generateMonthlyReportAi', { student_id: studentId, year, month });
  const body = await res.json().catch(() => null);
  if (!body || !body.ok) throw new ApiError((body && body.error) || 'AI 보고서를 만들지 못했습니다.');
  return body.data;
}

/** Download the report text as a PDF file. */
export async function downloadMonthlyPdf(studentId, year, month, text, studentName) {
  const res = await postJson('/api/monthly-report/pdf', { student_id: studentId, year, month, report_text: text });
  if (!res.ok || !(res.headers.get('content-type') || '').includes('pdf')) {
    const body = await res.json().catch(() => null);
    throw new ApiError((body && body.error) || 'PDF를 만들지 못했습니다.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${studentName || '학생'}_${year}-${String(month).padStart(2, '0')}_월간보고서.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Run async jobs with a small concurrency limit, reporting each result as it finishes. */
export async function runLimited(items, limit, job, onEach) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        const value = await job(items[i]);
        onEach(items[i], { ok: true, value });
      } catch (e) {
        onEach(items[i], { ok: false, error: e.message || String(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** AI plan draft for a class month (the AI call runs outside the DB lock on the server). */
export async function generatePlanAi(classId, month) {
  const res = await postJson('/api/generateClassPlanAi', { class_id: classId, month });
  const body = await res.json().catch(() => null);
  if (!body || !body.ok) throw new ApiError((body && body.error) || 'AI 계획을 만들지 못했습니다.');
  return body.data;
}

import { NextResponse } from 'next/server';
import { isAuthed } from '../../../lib/auth.js';
import { withService } from '../../../lib/store.js';
import {
  buildMonthlyAiSections,
  buildGenerateMonthlyReportAiData,
  isMonthlyAiConfigured
} from '../../../lib/monthly-ai.js';

export const runtime = 'nodejs';

export async function POST(req) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  if (!isMonthlyAiConfigured()) {
    return NextResponse.json({
      ok: false,
      error: 'AI API 키가 설정되지 않았습니다. AI_API_KEY(또는 OPENAI_API_KEY) 환경 변수를 설정해 주세요.'
    }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const studentId = body.student_id;
  const year = Number(body.year);
  const month = Number(body.month);
  if (!studentId || !year || !month) {
    return NextResponse.json({ ok: false, error: '학생, 연도, 월을 입력해 주세요.' }, { status: 400 });
  }

  try {
    const pack = await withService((api) => api.getMonthlyReportContext(studentId, year, month));
    const aiSections = await buildMonthlyAiSections(pack);
    return NextResponse.json({
      ok: true,
      data: buildGenerateMonthlyReportAiData(pack, aiSections)
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e && e.message ? e.message : String(e)
    });
  }
}

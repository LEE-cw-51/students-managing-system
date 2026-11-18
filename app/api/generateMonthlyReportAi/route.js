import { NextResponse } from 'next/server';
import { getSession, serviceFor } from '../../../lib/auth.js';
import {
  buildMonthlyAiSections,
  buildGenerateMonthlyReportAiData,
  isMonthlyAiConfigured
} from '../../../lib/monthly-ai.js';
import { errorResponse } from '../../../lib/api-error.js';
import { guardPost } from '../../../lib/request-guard.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  const refused = guardPost(req);
  if (refused) return refused;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  if (!isMonthlyAiConfigured()) {
    return NextResponse.json({
      ok: false,
      error: 'AI API 키가 설정되지 않았습니다. AI_API_KEY에 OpenRouter 키를 넣어 주세요.'
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
    const pack = await serviceFor(session)((api) => api.getMonthlyReportContext(studentId, year, month));
    const ai = await buildMonthlyAiSections(pack);
    return NextResponse.json({
      ok: true,
      data: buildGenerateMonthlyReportAiData(pack, ai.text, ai.model)
    });
  } catch (e) {
    return errorResponse(e);
  }
}

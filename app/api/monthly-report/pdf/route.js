import { NextResponse } from 'next/server';
import { isAuthed } from '../../../../lib/auth.js';
import { withService } from '../../../../lib/store.js';
import { renderMonthlyReportPdf } from '../../../../lib/monthly-pdf.js';
import { errorResponse } from '../../../../lib/api-error.js';
import { guardPost } from '../../../../lib/request-guard.js';

export const runtime = 'nodejs';

const REPORT_TEXT_MAX = 100000;

function safeFilename(name) {
  return String(name || 'report').replace(/[^\w\u3131-\uD79D.-]+/g, '_').slice(0, 80);
}

export async function POST(req) {
  const refused = guardPost(req);
  if (refused) return refused;
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const studentId = body.student_id;
  const year = Number(body.year);
  const month = Number(body.month);
  const reportText = String(body.report_text || '').trim();
  if (!studentId || !year || !month) {
    return NextResponse.json({ ok: false, error: '학생, 연도, 월을 입력해 주세요.' }, { status: 400 });
  }
  if (!reportText) {
    return NextResponse.json({ ok: false, error: 'PDF로 내보낼 보고서 내용이 없습니다.' }, { status: 400 });
  }
  if (reportText.length > REPORT_TEXT_MAX) {
    return NextResponse.json({ ok: false, error: '보고서 내용은 100,000자까지 PDF로 만들 수 있습니다.' }, { status: 400 });
  }

  try {
    const ctx = await withService((api) => ({ student: api.getStudent(studentId), settings: api.getSettings() }));
    const set = ctx.settings || {};
    const studentName = ctx.student.name || '학생';
    const academy = set.academy_name || '학원';
    const teacher = set.teacher_name || '';
    const contact = set.contact || '';

    const metaLines = [
      academy,
      `${year}년 ${month}월 · ${studentName}`,
      teacher ? `담당: ${teacher}` : '',
      contact ? `연락처: ${contact}` : ''
    ].filter(Boolean);

    const pdf = await renderMonthlyReportPdf({
      title: `${studentName} ${month}월 학습 보고서`,
      metaLines,
      body: reportText
    });

    const filenameUtf8 = `${studentName}_${year}-${String(month).padStart(2, '0')}_monthly.pdf`;
    const filenameAscii = safeFilename(`monthly_${year}-${String(month).padStart(2, '0')}.pdf`);
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filenameAscii}"; filename*=UTF-8''${encodeURIComponent(filenameUtf8)}`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (e) {
    return errorResponse(e);
  }
}

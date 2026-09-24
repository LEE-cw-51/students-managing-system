'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');
const { mergeMonthlyReportText, isMonthlyAiConfigured } = require('../lib/monthly-ai.js');
const { renderMonthlyReportPdf } = require('../lib/monthly-pdf.js');

function svc() {
  return LMS.createService(createMemoryStore());
}

describe('monthly report AI helpers', () => {
  it('merges base text and AI sections', () => {
    const merged = mergeMonthlyReportText('기본 본문', '【학습 분석】\n- 테스트');
    assert.match(merged, /기본 본문/);
    assert.match(merged, /【학습 분석】/);
  });

  it('reports whether AI key is configured', () => {
    const prev = process.env.AI_API_KEY;
    delete process.env.AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    assert.equal(isMonthlyAiConfigured(), false);
    process.env.AI_API_KEY = 'test-key';
    assert.equal(isMonthlyAiConfigured(), true);
    if (prev === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = prev;
  });
});

describe('getMonthlyReportContext', () => {
  it('includes lessons, counseling, and base text for a month', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반' });
    const s = api.createStudent({ name: '홍길동', class_id: c.class_id });
    api.saveLesson({
      lesson_date: '2026-09-05',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '실시',
      test_score: 80,
      test_max_score: 100,
      progress: '방정식',
      special_note: '숙제 지각'
    });
    api.saveCounselingNote({
      student_id: s.student_id,
      kind: '학부모',
      counsel_date: '2026-09-10',
      title: '학습 상담',
      content: '과제량 조절 요청'
    });
    const ctx = api.getMonthlyReportContext(s.student_id, 2026, 9);
    assert.equal(ctx.lessons.length, 1);
    assert.equal(ctx.counseling_notes.length, 1);
    assert.match(ctx.base_text, /홍길동/);
    assert.match(ctx.base_text, /숙제 지각/);
  });
});

describe('monthly report PDF', () => {
  it('renders a PDF buffer with Korean text', { timeout: 120000 }, async () => {
    const buf = await renderMonthlyReportPdf({
      title: '테스트 보고서',
      metaLines: ['데모 학원', '2026년 9월 · 홍길동'],
      body: '【학습 분석】\n한글 PDF 렌더링 테스트입니다.'
    });
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 500);
    assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  });
});

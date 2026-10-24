'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');

function svc() {
  return LMS.createService(createMemoryStore());
}

describe('normalizeTime', () => {
  const cases = [
    ['1800', '18:00'],
    ['930', '09:30'],
    ['18', '18:00'],
    ['9', '09:00'],
    ['18:3', '18:30'],
    ['183', '18:30'],
    ['18:05', '18:05'],
    ['0730', '07:30'],
    [' 19 00 ', '19:00'],
    ['', '']
  ];
  cases.forEach(([input, expected]) => {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      assert.equal(LMS.normalizeTime(input), expected);
    });
  });

  ['2560', '24', '18:60', 'ab', '12345', '1:2:3'].forEach((input) => {
    it(`rejects ${input}`, () => {
      assert.equal(LMS.normalizeTime(input), null);
    });
  });
});

describe('class schedule', () => {
  it('sorts by weekday and rejects end before start', () => {
    const list = LMS.normalizeSchedule([
      { day: '수', start: '1900', end: '2100' },
      { day: '월', start: '18', end: '20' }
    ]);
    assert.deepEqual(list, [
      { day: '월', start: '18:00', end: '20:00' },
      { day: '수', start: '19:00', end: '21:00' }
    ]);
    assert.throws(() => LMS.normalizeSchedule([{ day: '월', start: '20', end: '18' }]), /종료 시간/);
    assert.throws(() => LMS.normalizeSchedule([{ day: '월' }, { day: '월' }]), /중복/);
  });

  it('builds legacy summary and per-day times', () => {
    const cls = { status: '운영', schedule: [{ day: '월', start: '18:00', end: '20:00' }, { day: '수', start: '19:00', end: '21:00' }] };
    assert.deepEqual(LMS.scheduleSummary(cls.schedule), { weekday: '월/수', start_time: '18:00', end_time: '20:00' });
    assert.deepEqual(LMS.classTimeOn(cls, '2026-10-21'), { start: '19:00', end: '21:00' }); // 수
    assert.equal(LMS.classTimeOn(cls, '2026-10-20'), null); // 화
    assert.equal(LMS.scheduleLabel(cls.schedule), '월 18:00–20:00 · 수 19:00–21:00');
  });

  it('treats an empty schedule as no meetings', () => {
    const cls = { status: '운영', weekday: '', start_time: '', end_time: '' };
    assert.equal(LMS.classMeetsOnDate(cls, '2026-10-19', []), false);
  });

  it('createClass accepts schedule and derives weekday fields', () => {
    const api = svc();
    const cls = api.createClass({
      class_name: '중2 심화',
      schedule: [{ day: '수', start: '1900', end: '2100' }, { day: '월', start: '1800', end: '2000' }]
    });
    assert.equal(cls.weekday, '월/수');
    assert.equal(cls.start_time, '18:00');
    assert.equal(cls.class_type, '정규');
    assert.equal(cls.schedule.length, 2);
  });

  it('legacy update with the same summary keeps per-day times (R6)', () => {
    const api = svc();
    const cls = api.createClass({
      class_name: '중2 심화',
      schedule: [{ day: '월', start: '18:00', end: '20:00' }, { day: '수', start: '19:00', end: '21:00' }]
    });
    const updated = api.updateClass(Object.assign({}, cls, { schedule: undefined, class_name: '중2 심화반' }));
    assert.equal(updated.class_name, '중2 심화반');
    assert.deepEqual(updated.schedule[1], { day: '수', start: '19:00', end: '21:00' });

    const changed = api.updateClass({ class_id: cls.class_id, class_name: '중2 심화반', weekday: '화/목', start_time: '17:00', end_time: '19:00' });
    assert.deepEqual(changed.schedule.map((s) => s.day), ['화', '목']);

    const partial = api.updateClass({ class_id: cls.class_id, class_name: '이름만' });
    assert.deepEqual(partial.schedule.map((s) => s.day), ['화', '목']);
  });

  it('makeup times accept typed numbers', () => {
    const api = svc();
    const cls = api.createClass({ class_name: 'A', weekday: '월', start_time: '18:00', end_time: '20:00' });
    const row = api.saveMakeupSession({ makeup_date: '2026-10-22', kind: '반', class_id: cls.class_id, start_time: '1500', end_time: '1630' });
    const saved = Array.isArray(row) ? row[0] : row;
    assert.equal(saved.start_time, '15:00');
    assert.equal(saved.end_time, '16:30');
  });
});

describe('date-based meetings and rosters', () => {
  const periods = [{
    exam_period_id: 'EXP_1', title: '중간', start_date: '2026-10-05', end_date: '2026-10-25',
    suspended_class_ids: ['CLS_A'], status: '진행'
  }];
  const regular = { class_id: 'CLS_A', status: '운영', class_type: '정규', schedule: [{ day: '화', start: '19:00', end: '21:00' }] };
  const exam = { class_id: 'CLS_X', status: '운영', class_type: '시험대비', exam_period_id: 'EXP_1', schedule: [{ day: '월', start: '18:00', end: '20:00' }] };

  it('suspends regular classes and runs exam classes only in the period', () => {
    assert.equal(LMS.classMeetsOnDate(regular, '2026-10-13', periods), false);
    assert.equal(LMS.classMeetsOnDate(regular, '2026-10-27', periods), true);
    assert.equal(LMS.classMeetsOnDate(exam, '2026-10-12', periods), true);
    assert.equal(LMS.classMeetsOnDate(exam, '2026-10-26', periods), false);
    assert.equal(LMS.classMeetsOnDate(exam, '2026-09-28', periods), false);
  });

  it('finds the last real meeting before a 3-week suspension (R3)', () => {
    assert.equal(LMS.previousMeetingDateFor(regular, '2026-10-27', periods), '2026-09-29');
    assert.equal(LMS.previousClassMeetingDate('화', '2026-10-27'), '2026-10-20');
  });

  it('relActiveOn honours start, end and temporary rows', () => {
    assert.equal(LMS.relActiveOn({ status: '현재', start_date: '2026-03-01', end_date: '' }, '2026-10-01'), true);
    assert.equal(LMS.relActiveOn({ status: '현재', start_date: '2026-11-01', end_date: '' }, '2026-10-01'), false);
    assert.equal(LMS.relActiveOn({ status: '종료', start_date: '2026-03-01', end_date: '2026-09-30' }, '2026-09-15'), true);
    assert.equal(LMS.relActiveOn({ status: '종료', start_date: '2026-03-01', end_date: '2026-09-30' }, '2026-10-01'), false);
    assert.equal(LMS.relActiveOn({ status: '임시', start_date: '2026-10-05', end_date: '2026-10-25' }, '2026-10-26'), false);
  });

  it('schoolGroupKey normalises school spelling', () => {
    assert.equal(LMS.schoolGroupKey('한빛중학교', '중2'), LMS.schoolGroupKey(' 한빛 중 ', '중2'));
    assert.equal(LMS.schoolGroupKey('', '중2'), '');
  });
});

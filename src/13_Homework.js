/**
 * Homework items, checks, and weekly dashboard.
 * Owns HomeworkItems / HomeworkChecks writes and lesson-date helpers used by ClassDay/Views.
 * Session copy locality stays in 03_Sessions.js; this module only calls sessionSync.
 * Server-only: reads tables.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: table, saveTable, now, nextIds, requireClass, requireStudent,
 * sessionSync, getLessons, examPeriods_, assignments, today().
 * Callers run commands inside the service transaction.
 */
LMS.createHomework = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;
  var sessionSync = ctx.sessionSync;

  function legacyHomeworkItems_(date, classId) {
    // The text most student rows carry, so one student's diverging row never becomes the class homework.
    var text = LMS.modeValue(ctx.getLessons(date, classId).map(function (l) { return LMS.toStr(l.homework); }));
    if (!text) {
      var cls = LMS.findById(table('Classes'), 'class_id', classId);
      if (cls) text = LMS.toStr(cls.class_homework);
    }
    return LMS.splitHomeworkLines(text).map(function (title, idx) {
      return {
        item_id: '',
        lesson_date: LMS.toStr(date),
        class_id: LMS.toStr(classId),
        title: title,
        sort_order: idx,
        student_id: '',
        legacy: true
      };
    });
  }

  function enrichHomeworkItem_(it) {
    var studentId = LMS.toStr(it.student_id);
    return {
      item_id: it.item_id,
      lesson_date: it.lesson_date,
      class_id: it.class_id,
      title: it.title,
      sort_order: it.sort_order,
      student_id: studentId,
      scope: studentId ? 'student' : 'class',
      legacy: !!it.legacy
    };
  }

  function homeworkReplaceOn_(date, classId, studentId) {
    var lessons = table('Lessons');
    for (var i = 0; i < lessons.length; i++) {
      var row = lessons[i];
      if (LMS.toStr(row.lesson_date) === LMS.toStr(date) &&
          LMS.toStr(row.class_id) === LMS.toStr(classId) &&
          LMS.toStr(row.student_id) === LMS.toStr(studentId)) {
        return row.homework_replace_class;
      }
    }
    return '';
  }

  function setHomeworkReplaceOn_(date, classId, studentId, replaceClass) {
    var lessons = table('Lessons');
    var ts = ctx.now();
    var found = false;
    var next = LMS.normalizeHomeworkReplaceClass(replaceClass);
    lessons.forEach(function (row) {
      if (LMS.toStr(row.lesson_date) !== LMS.toStr(date)) return;
      if (LMS.toStr(row.class_id) !== LMS.toStr(classId)) return;
      if (LMS.toStr(row.student_id) !== LMS.toStr(studentId)) return;
      found = true;
      if (LMS.toStr(row.homework_replace_class) === next) return;
      row.homework_replace_class = next;
      row.updated_at = ts;
    });
    if (found) saveTable('Lessons', lessons);
    return next;
  }

  function getSessionHomework(date, classId) {
    ctx.requireClass(classId);
    if (!LMS.isIsoDate(LMS.toStr(date))) {
      throw new Error('수업 날짜가 올바르지 않습니다.');
    }
    var items = sessionSync.homeworkItems(date, classId);
    var fromLegacy = false;
    if (!items.length) {
      items = legacyHomeworkItems_(date, classId);
      fromLegacy = !!items.length;
    }
    var checks = table('HomeworkChecks');
    var itemIds = items.map(function (it) { return it.item_id; }).filter(Boolean);
    var enrichedItems = items.map(enrichHomeworkItem_);
    return {
      lesson_date: LMS.toStr(date),
      class_id: LMS.toStr(classId),
      items: enrichedItems,
      class_items: enrichedItems.filter(function (it) { return it.scope === 'class'; }),
      from_legacy: fromLegacy,
      checks: checks.filter(function (c) {
        return itemIds.indexOf(LMS.toStr(c.item_id)) !== -1;
      })
    };
  }

  /**
   * Upsert checklist rows for one owner (class-shared when studentId is empty). Leaves other
   * owners' rows on the same date alone so personal homework survives a class-list edit.
   */
  function replaceHomeworkItems_(date, classId, studentId, incoming) {
    studentId = LMS.toStr(studentId);
    var rows = table('HomeworkItems');
    var others = rows.filter(function (row) {
      if (LMS.toStr(row.lesson_date) !== date || LMS.toStr(row.class_id) !== classId) return true;
      return LMS.toStr(row.student_id) !== studentId;
    });
    var existing = rows.filter(function (row) {
      return LMS.toStr(row.lesson_date) === date &&
        LMS.toStr(row.class_id) === classId &&
        LMS.toStr(row.student_id) === studentId;
    }).sort(function (a, b) {
      var so = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
      if (so) return so;
      return LMS.toStr(a.item_id).localeCompare(LMS.toStr(b.item_id));
    });
    var byId = {};
    existing.forEach(function (row) { byId[LMS.toStr(row.item_id)] = row; });
    var unused = existing.slice();
    var planned = [];
    var createCount = 0;

    function takeUnused(pred) {
      for (var i = 0; i < unused.length; i++) {
        if (pred(unused[i], i)) {
          return unused.splice(i, 1)[0];
        }
      }
      return null;
    }

    incoming.forEach(function (inc) {
      var match = null;
      if (inc.item_id && byId[inc.item_id] && LMS.toStr(byId[inc.item_id].student_id) === studentId) {
        match = takeUnused(function (row) {
          return LMS.toStr(row.item_id) === inc.item_id;
        });
      }
      if (!match) {
        match = takeUnused(function (row) {
          return LMS.toStr(row.title) === inc.title;
        });
      }
      if (!match && unused.length) {
        // Rename in place so checks stay attached when slots are edited.
        match = unused.shift();
      }
      if (match) {
        planned.push({
          item_id: match.item_id,
          title: inc.title,
          created_at: match.created_at,
          isNew: false
        });
      } else {
        createCount += 1;
        planned.push({
          item_id: '',
          title: inc.title,
          created_at: '',
          isNew: true
        });
      }
    });

    var oldItems = existing.slice();
    var oldChecks = table('HomeworkChecks').filter(function (c) { return !!byId[LMS.toStr(c.item_id)]; });
    var removedIds = unused.map(function (row) { return LMS.toStr(row.item_id); });
    if (removedIds.length) {
      var checks = table('HomeworkChecks').filter(function (c) {
        return removedIds.indexOf(LMS.toStr(c.item_id)) === -1;
      });
      saveTable('HomeworkChecks', checks);
    }

    var ts = ctx.now();
    var newIds = createCount ? ctx.nextIds('HWI', createCount) : [];
    var idPos = 0;
    var saved = planned.map(function (plan, idx) {
      var itemId = plan.isNew ? newIds[idPos++] : plan.item_id;
      return {
        item_id: itemId,
        lesson_date: date,
        class_id: classId,
        title: plan.title,
        sort_order: idx,
        student_id: studentId,
        created_at: plan.isNew ? ts : (plan.created_at || ts),
        updated_at: ts
      };
    });
    saveTable('HomeworkItems', others.concat(saved));
    sessionSync.afterHomeworkChanged(date, classId);
    regradeCheckedLesson_(date, classId, oldItems, oldChecks);
    return saved;
  }

  function parseHomeworkIncoming_(data) {
    var incoming = [];
    if (Array.isArray(data.items)) {
      data.items.forEach(function (it) {
        if (typeof it === 'string') {
          var s = LMS.toStr(it);
          if (s) incoming.push({ title: s, item_id: '' });
          return;
        }
        var t = LMS.toStr(it && it.title);
        if (!t) return;
        incoming.push({ title: t, item_id: LMS.toStr(it && it.item_id) });
      });
    } else if (Array.isArray(data.titles)) {
      data.titles.forEach(function (t) {
        var s = LMS.toStr(t);
        if (s) incoming.push({ title: s, item_id: '' });
      });
    }
    return incoming;
  }

  function saveSessionHomework(data) {
    data = data || {};
    var date = LMS.toStr(data.lesson_date || data.date);
    var classId = LMS.toStr(data.class_id);
    ctx.requireClass(classId);
    if (!LMS.isIsoDate(date)) throw new Error('수업 날짜가 올바르지 않습니다.');
    replaceHomeworkItems_(date, classId, '', parseHomeworkIncoming_(data));
    return getSessionHomework(date, classId);
  }

  function saveStudentHomeworkItems(data) {
    data = data || {};
    var date = LMS.toStr(data.lesson_date || data.date);
    var classId = LMS.toStr(data.class_id);
    var studentId = LMS.toStr(data.student_id);
    ctx.requireClass(classId);
    ctx.requireStudent(studentId);
    if (!LMS.isIsoDate(date)) throw new Error('수업 날짜가 올바르지 않습니다.');
    if (Object.prototype.hasOwnProperty.call(data, 'replace_class') ||
        Object.prototype.hasOwnProperty.call(data, 'homework_replace_class')) {
      setHomeworkReplaceOn_(date, classId, studentId,
        data.replace_class !== undefined ? data.replace_class : data.homework_replace_class);
    }
    if (Array.isArray(data.items) || Array.isArray(data.titles)) {
      replaceHomeworkItems_(date, classId, studentId, parseHomeworkIncoming_(data));
    } else {
      sessionSync.afterHomeworkChanged(date, classId);
    }
    return {
      lesson_date: date,
      class_id: classId,
      student_id: studentId,
      homework_replace_class: homeworkReplaceOn_(date, classId, studentId),
      items: getSessionHomework(date, classId).items.filter(function (it) {
        return LMS.toStr(it.student_id) === studentId;
      })
    };
  }

  /**
   * Date whose homework is checked at the lesson on `date`: the previous scheduled meeting, or a
   * later recorded day (a makeup, or a day of the class's old timetable) when there is one.
   */
  function priorLessonDate_(cls, date) {
    var best = LMS.previousMeetingDateFor(cls, date, ctx.examPeriods_());
    var floor = best || LMS.addDays(date, -90);
    var classId = LMS.toStr(cls.class_id);
    var consider = function (row) {
      var d = LMS.toStr(row.lesson_date);
      if (LMS.toStr(row.class_id) !== classId || d >= date || d <= floor || (best && d <= best)) return;
      best = d;
    };
    table('Lessons').forEach(consider);
    table('ClassSessions').forEach(consider);
    table('HomeworkItems').forEach(consider);
    return best;
  }

  /**
   * Recorded lesson day (Lessons or ClassSessions) that checked the homework given on
   * `assignedDate`: the earliest one whose prior lesson is `assignedDate`, or '' if none yet.
   */
  function checkingLessonDate_(cls, assignedDate) {
    var classId = LMS.toStr(cls.class_id);
    assignedDate = LMS.toStr(assignedDate);
    var seen = {};
    var dates = [];
    var collect = function (row) {
      var d = LMS.toStr(row.lesson_date);
      if (LMS.toStr(row.class_id) !== classId || d <= assignedDate || seen[d]) return;
      seen[d] = true;
      dates.push(d);
    };
    table('Lessons').forEach(collect);
    table('ClassSessions').forEach(collect);
    dates.sort();
    for (var i = 0; i < dates.length; i++) {
      var prior = priorLessonDate_(cls, dates[i]);
      if (prior === assignedDate) return dates[i];
      if (prior > assignedDate) break;
    }
    return '';
  }

  /**
   * After the homework items of `date` change, the auto grades written on the lesson that checked
   * them follow the new items. A grade the teacher picked by hand (≠ the old auto grade) is kept.
   */
  function regradeCheckedLesson_(date, classId, oldItems, oldChecks) {
    if (!oldChecks.length) return;
    var cls = LMS.findById(table('Classes'), 'class_id', classId);
    if (!cls) return;
    var checkDate = checkingLessonDate_(cls, date);
    if (!checkDate) return;
    var items = sessionSync.homeworkItems(date, classId);
    var ids = {};
    items.forEach(function (it) { ids[LMS.toStr(it.item_id)] = true; });
    var checks = table('HomeworkChecks').filter(function (c) { return !!ids[LMS.toStr(c.item_id)]; });
    var allOld = sessionSync.homeworkItems(date, classId);
    // Merge previous snapshot of the edited owner into the current full list for "before" grades.
    var oldById = {};
    (oldItems || []).forEach(function (it) { oldById[LMS.toStr(it.item_id)] = it; });
    var beforeItems = allOld.map(function (it) {
      return oldById[LMS.toStr(it.item_id)] || it;
    }).concat((oldItems || []).filter(function (it) {
      return !ids[LMS.toStr(it.item_id)];
    }));
    var lessons = table('Lessons');
    var changed = false;
    lessons.forEach(function (row) {
      if (LMS.toStr(row.class_id) !== LMS.toStr(classId) || LMS.toStr(row.lesson_date) !== checkDate) return;
      var replace = homeworkReplaceOn_(date, classId, row.student_id);
      var before = homeworkCompletionForStudent_(
        LMS.homeworkItemsForStudent(beforeItems, row.student_id, replace), oldChecks, row.student_id
      ).grade;
      if (!before || LMS.toStr(row.assignment_completion) !== before) return;
      var after = homeworkCompletionForStudent_(
        LMS.homeworkItemsForStudent(items, row.student_id, replace), checks, row.student_id
      ).grade;
      if (after === before) return;
      row.assignment_completion = after;
      row.updated_at = ctx.now();
      changed = true;
    });
    if (changed) saveTable('Lessons', lessons);
  }

  function homeworkCompletionForStudent_(items, checks, studentId) {
    var list = items || [];
    if (!list.length) return { done: 0, total: 0, grade: '', score: null };
    var letters = [];
    var done = 0;
    list.forEach(function (it) {
      var itemId = LMS.toStr(it.item_id);
      if (!itemId) return;
      var hit = (checks || []).filter(function (c) {
        return LMS.toStr(c.item_id) === itemId && LMS.toStr(c.student_id) === LMS.toStr(studentId);
      })[0];
      var grade = hit ? LMS.homeworkGrade(hit.status) : '';
      if (!grade) return;
      letters.push(grade);
      if (LMS.isHomeworkDone(grade)) done += 1;
    });
    var agg = LMS.aggregateAssignmentGrades(letters);
    return {
      done: done,
      total: list.filter(function (it) { return LMS.toStr(it.item_id); }).length,
      grade: agg.grade,
      score: agg.score
    };
  }

  function effectiveHomeworkItems_(items, date, classId, studentId) {
    return LMS.homeworkItemsForStudent(items, studentId, homeworkReplaceOn_(date, classId, studentId));
  }

  function saveHomeworkChecks(data) {
    data = data || {};
    var date = LMS.toStr(data.lesson_date || data.assigned_date || data.date);
    var classId = LMS.toStr(data.class_id);
    var checkDate = LMS.toStr(data.check_date);
    var cls = ctx.requireClass(classId);
    if (!LMS.isIsoDate(date)) throw new Error('숙제 배정일 형식이 올바르지 않습니다.');
    if (checkDate && !LMS.isIsoDate(checkDate)) {
      throw new Error('확인일 형식이 올바르지 않습니다.');
    }
    var session = getSessionHomework(date, classId);
    var items = session.items;
    if (session.from_legacy && items.length) {
      session = saveSessionHomework({
        lesson_date: date,
        class_id: classId,
        items: items.filter(LMS.isClassHomeworkItem).map(function (it) { return { title: it.title }; })
      });
      items = session.items;
    }
    if (!items.length) throw new Error('확인할 숙제 항목이 없습니다.');
    if (!checkDate || priorLessonDate_(cls, checkDate) !== date) checkDate = checkingLessonDate_(cls, date);
    var itemById = {};
    items.forEach(function (it) { itemById[LMS.toStr(it.item_id)] = it; });
    var classItems = items.filter(LMS.isClassHomeworkItem);
    var incoming = Array.isArray(data.checks) ? data.checks : [];
    var rows = table('HomeworkChecks');
    var ts = ctx.now();
    var byKey = {};
    rows.forEach(function (row, idx) {
      byKey[LMS.toStr(row.item_id) + '|' + LMS.toStr(row.student_id)] = idx;
    });
    var studentIds = {};
    incoming.forEach(function (c) {
      var itemId = LMS.toStr(c.item_id);
      var studentId = LMS.toStr(c.student_id);
      if (!itemId && c.index !== undefined && c.index !== null && classItems[Number(c.index)]) {
        itemId = LMS.toStr(classItems[Number(c.index)].item_id);
      }
      if (!itemId && c.title) {
        var byTitle = effectiveHomeworkItems_(items, date, classId, studentId).filter(function (it) {
          return LMS.toStr(it.title) === LMS.toStr(c.title);
        })[0];
        if (byTitle) itemId = LMS.toStr(byTitle.item_id);
      }
      var item = itemById[itemId];
      if (!item) throw new Error('숙제 항목을 찾을 수 없습니다.');
      ctx.requireStudent(studentId);
      var owner = LMS.toStr(item.student_id);
      if (owner && owner !== studentId) throw new Error('다른 학생의 개인 숙제는 확인할 수 없습니다.');
      var raw = LMS.toStr(c.status);
      var status = raw ? LMS.homeworkGrade(raw) : '';
      if (raw && !status) throw new Error('숙제 등급은 A부터 F까지입니다.');
      studentIds[studentId] = true;
      var key = itemId + '|' + studentId;
      if (!status) {
        if (Object.prototype.hasOwnProperty.call(byKey, key)) {
          rows.splice(byKey[key], 1);
          byKey = {};
          rows.forEach(function (row, idx) {
            byKey[LMS.toStr(row.item_id) + '|' + LMS.toStr(row.student_id)] = idx;
          });
        }
        return;
      }
      if (Object.prototype.hasOwnProperty.call(byKey, key)) {
        var existing = rows[byKey[key]];
        existing.status = status;
        existing.updated_at = ts;
      } else {
        var created = {
          check_id: ctx.nextIds('HWC', 1)[0],
          item_id: itemId,
          student_id: studentId,
          status: status,
          created_at: ts,
          updated_at: ts
        };
        byKey[key] = rows.length;
        rows.push(created);
      }
    });
    saveTable('HomeworkChecks', rows);

    var checksForItems = rows.filter(function (c) {
      return !!itemById[LMS.toStr(c.item_id)];
    });
    var grades = [];
    var gradeByStudent = {};
    Object.keys(studentIds).forEach(function (studentId) {
      var effective = effectiveHomeworkItems_(items, date, classId, studentId);
      var comp = homeworkCompletionForStudent_(effective, checksForItems, studentId);
      grades.push({
        student_id: studentId,
        done: comp.done,
        total: comp.total,
        score: comp.score,
        assignment_completion: comp.grade
      });
      gradeByStudent[studentId] = comp.grade;
    });
    if (checkDate && Object.keys(gradeByStudent).length) {
      var lessonRows = table('Lessons');
      var lessonsChanged = false;
      lessonRows.forEach(function (row) {
        if (LMS.toStr(row.class_id) !== classId || LMS.toStr(row.lesson_date) !== checkDate) return;
        var sid = LMS.toStr(row.student_id);
        if (!Object.prototype.hasOwnProperty.call(gradeByStudent, sid)) return;
        row.assignment_completion = gradeByStudent[sid];
        row.updated_at = ts;
        lessonsChanged = true;
      });
      if (lessonsChanged) saveTable('Lessons', lessonRows);
    }

    return {
      assigned_date: date,
      check_date: checkDate,
      class_id: classId,
      items: items,
      checks: checksForItems,
      grades: grades
    };
  }

  function buildHomeworkSlot_(classId, className, checkDate, assignedDate, rosterIds) {
    var session = assignedDate ? getSessionHomework(assignedDate, classId) : { items: [], checks: [] };
    var items = session.items || [];
    var checks = session.checks || [];
    var classItems = items.filter(LMS.isClassHomeworkItem);
    var itemCount = classItems.filter(function (it) { return it.item_id || it.title; }).length;
    var doneCells = 0;
    var totalCells = 0;
    var studentsIncomplete = 0;
    (rosterIds || []).forEach(function (studentId) {
      var effective = assignedDate
        ? effectiveHomeworkItems_(items.filter(function (it) { return it.item_id; }), assignedDate, classId, studentId)
        : [];
      var comp = homeworkCompletionForStudent_(effective, checks, studentId);
      if (!items.some(function (it) { return it.item_id; }) && itemCount) {
        // legacy titles without ids: treat as incomplete until materialized
        studentsIncomplete += 1;
        return;
      }
      doneCells += comp.done;
      totalCells += comp.total;
      if (comp.total && comp.done < comp.total) studentsIncomplete += 1;
      if (!comp.total && (itemCount || effective.length)) studentsIncomplete += 1;
    });
    return {
      check_date: checkDate,
      assigned_date: assignedDate || '',
      items: classItems.map(function (it) {
        return { item_id: it.item_id, title: it.title, sort_order: it.sort_order, scope: 'class' };
      }),
      completion: {
        done: doneCells,
        total: totalCells,
        students_incomplete: studentsIncomplete,
        item_count: itemCount,
        student_count: (rosterIds || []).length
      }
    };
  }

  function getWeeklyHomeworkDashboard(anchorDate) {
    anchorDate = anchorDate || ctx.today();
    if (!LMS.isIsoDate(anchorDate)) throw new Error('날짜 형식이 올바르지 않습니다.');
    var week = LMS.weekRange(anchorDate);
    var periods = ctx.examPeriods_();
    var classes = table('Classes').filter(function (c) {
      return LMS.toStr(c.status) === '운영';
    }).sort(function (a, b) {
      return LMS.toStr(a.class_name).localeCompare(LMS.toStr(b.class_name), 'ko');
    });
    var result = classes.map(function (cls) {
      var meetingDates = LMS.classMeetingDatesFor(cls, week.start, week.end, periods);
      var slots = meetingDates.map(function (checkDate) {
        var rosterIds = ctx.assignments.recordTargets(cls.class_id, checkDate).students.map(function (s) {
          return s.student_id;
        });
        var assigned = priorLessonDate_(cls, checkDate);
        return buildHomeworkSlot_(cls.class_id, cls.class_name, checkDate, assigned, rosterIds);
      });
      var incompleteSlots = slots.filter(function (s) {
        return s.completion.item_count > 0 && s.completion.students_incomplete > 0;
      }).length;
      return {
        class_id: cls.class_id,
        class_name: cls.class_name,
        weekday: cls.weekday,
        slots: slots,
        incomplete_slot_count: incompleteSlots
      };
    }).filter(function (row) {
      return row.slots.length > 0;
    });
    return {
      anchor_date: anchorDate,
      week_start: week.start,
      week_end: week.end,
      week_label: LMS.formatKoreanDate(week.start) + ' ~ ' + LMS.formatKoreanDate(week.end),
      classes: result
    };
  }

  return {
    getSessionHomework: getSessionHomework,
    saveSessionHomework: saveSessionHomework,
    saveStudentHomeworkItems: saveStudentHomeworkItems,
    saveHomeworkChecks: saveHomeworkChecks,
    getWeeklyHomeworkDashboard: getWeeklyHomeworkDashboard,
    homeworkReplaceOn_: homeworkReplaceOn_,
    enrichHomeworkItem_: enrichHomeworkItem_,
    priorLessonDate_: priorLessonDate_,
    checkingLessonDate_: checkingLessonDate_,
    effectiveHomeworkItems_: effectiveHomeworkItems_
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}

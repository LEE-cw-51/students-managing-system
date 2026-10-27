/**
 * Class sessions (ClassSessions) are the source of the class values of a lesson date: progress,
 * test difficulty and max score, plus the homework text of the date's checklist. Student lessons
 * carry copies of them; every copy and write-back between the two goes through this module.
 * Terms follow GLOSSARY.md (반 기록, 학생 수업 기록). Server-only.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: { table(name) → rows, saveTable(name, rows), now() → timestamp, nextIds(prefix, count),
 * saveHomework(date, classId, titles) → replaces the date's checklist }. Callers run commands
 * inside the service transaction.
 */
LMS.createSessionSync = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;

  function sameDay(row, date, classId) {
    return LMS.sessionKey(row.lesson_date, row.class_id) === LMS.sessionKey(date, classId);
  }

  /** The (date, class) session row, or null. */
  function find(date, classId) {
    var rows = table('ClassSessions');
    for (var i = 0; i < rows.length; i++) {
      if (sameDay(rows[i], date, classId)) return rows[i];
    }
    return null;
  }

  /** Merge the given session fields into the (date, class) row, creating it when missing. */
  function upsert(fields) {
    var date = LMS.toStr(fields.lesson_date);
    var classId = LMS.toStr(fields.class_id);
    var rows = table('ClassSessions');
    var row = find(date, classId);
    var ts = ctx.now();
    if (!row) {
      row = {
        session_id: ctx.nextIds('SES', 1)[0],
        lesson_date: date,
        class_id: classId,
        progress: '',
        content: '',
        test_title: '',
        test_max_score: '',
        test_difficulty: '',
        class_notice: '',
        memo: '',
        created_at: ts,
        updated_at: ts
      };
      rows.push(row);
    }
    LMS.CLASS_SESSION_FIELDS.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(fields, key) && fields[key] !== undefined) {
        row[key] = fields[key];
      }
    });
    row.updated_at = ts;
    saveTable('ClassSessions', rows);
    return row;
  }

  /** The checklist items of a date in display order. */
  function homeworkItems(date, classId) {
    return table('HomeworkItems').filter(function (row) {
      return LMS.toStr(row.lesson_date) === LMS.toStr(date) &&
        LMS.toStr(row.class_id) === LMS.toStr(classId);
    }).sort(function (a, b) {
      var so = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
      if (so) return so;
      return LMS.toStr(a.item_id).localeCompare(LMS.toStr(b.item_id));
    });
  }

  function lessonsOn(date, classId) {
    return table('Lessons').filter(function (row) {
      return sameDay(row, date, classId);
    }).sort(function (a, b) {
      return LMS.toStr(a.student_id).localeCompare(LMS.toStr(b.student_id));
    });
  }

  /** The class homework text of a date: its checklist items, else the text most student rows carry (legacy). */
  function homeworkText(date, classId) {
    var items = homeworkItems(date, classId);
    if (items.length) return LMS.joinHomeworkTitles(items);
    return LMS.modeValue(lessonsOn(date, classId).map(function (l) { return LMS.toStr(l.homework); }));
  }

  function tested(row) {
    return LMS.toStr(row.test_status) === '실시';
  }

  /**
   * Copy the class values of a date onto every student lesson of that date and class. Difficulty
   * and max score go to tested rows only; untested rows carry neither.
   * options.prevMax: the session max before this save; options.homework: text to use when the date has
   * no checklist; options.realign: v4 migration (homework only from a checklist, untested rows and
   * max scores left alone).
   */
  function copyToLessons(date, classId, options) {
    options = options || {};
    var session = find(date, classId);
    var homework = null;
    if (homeworkItems(date, classId).length) homework = homeworkText(date, classId);
    else if (options.homework !== undefined) homework = LMS.toStr(options.homework);
    else if (!options.realign) homework = homeworkText(date, classId);
    if (!session && homework === null) return;
    var lessons = table('Lessons');
    var prevMax = options.prevMax;
    var changed = false;
    lessons.forEach(function (row) {
      if (!sameDay(row, date, classId)) return;
      var next = {};
      if (session) {
        next.progress = LMS.toStr(session.progress);
        if (tested(row)) {
          next.test_difficulty = LMS.toStr(session.test_difficulty);
          // Max score follows the session (a cleared one too) unless the row carries its own value.
          if (!options.realign && (LMS.isBlank(row.test_max_score) ||
              (!LMS.isBlank(prevMax) && LMS.toStr(row.test_max_score) === LMS.toStr(prevMax)))) {
            next.test_max_score = session.test_max_score;
          }
        } else if (!options.realign) {
          next.test_difficulty = '';
          next.test_max_score = '';
        }
      }
      if (homework !== null) next.homework = homework;
      Object.keys(next).forEach(function (k) {
        if (LMS.toStr(row[k]) !== LMS.toStr(next[k])) {
          row[k] = next[k];
          changed = true;
        }
      });
    });
    if (changed) saveTable('Lessons', lessons);
  }

  /**
   * Keep Classes.current_progress on the latest recorded progress. prevProgress is the session's
   * progress before this save: clearing the progress the class shows falls back to the latest left.
   */
  function syncClassProgress(session, prevProgress) {
    var progress = LMS.toStr(session.progress);
    var classId = LMS.toStr(session.class_id);
    var latest = table('ClassSessions').filter(function (r) {
      return LMS.toStr(r.class_id) === classId && LMS.toStr(r.progress);
    }).sort(function (a, b) {
      return LMS.toStr(a.lesson_date).localeCompare(LMS.toStr(b.lesson_date));
    }).pop();
    var classes = table('Classes');
    var cls = LMS.findById(classes, 'class_id', classId);
    if (!cls) return;
    var next;
    if (progress) {
      if (latest && LMS.toStr(latest.lesson_date) > LMS.toStr(session.lesson_date)) return;
      next = progress;
    } else {
      if (!latest || !prevProgress || LMS.toStr(cls.current_progress) !== LMS.toStr(prevProgress)) return;
      next = LMS.toStr(latest.progress);
    }
    if (LMS.toStr(cls.current_progress) === next) return;
    cls.current_progress = next;
    cls.updated_at = ctx.now();
    saveTable('Classes', classes);
  }

  /** Save the class record of a date (validated input) and copy it onto its student lessons. */
  function saveSession(input) {
    var prev = find(input.lesson_date, input.class_id);
    var prevMax = prev ? prev.test_max_score : undefined;
    var prevProgress = prev ? LMS.toStr(prev.progress) : '';
    var row = upsert(input);
    copyToLessons(row.lesson_date, row.class_id, { prevMax: prevMax });
    syncClassProgress(row, prevProgress);
    return row;
  }

  function saveNotice(date, classId, text) {
    return upsert({ lesson_date: date, class_id: classId, class_notice: LMS.toStr(text) });
  }

  /**
   * After student lessons are saved. Legacy forms send progress / homework / test meta on each
   * student row (rawList[i] is the input of saved[i]): when they do, that becomes the class record;
   * then the class record is copied back onto the rows.
   */
  function afterLessonsSaved(rawList, saved) {
    var groups = {};
    saved.forEach(function (row, i) {
      var key = LMS.sessionKey(row.lesson_date, row.class_id);
      if (!groups[key]) groups[key] = { date: row.lesson_date, classId: row.class_id, raws: [], testedRaws: [] };
      groups[key].raws.push(rawList[i] || {});
      if (tested(row)) groups[key].testedRaws.push(rawList[i] || {});
    });
    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      var fields = {};
      var progress = LMS.modeValue(g.raws.map(function (r) { return LMS.toStr(r.progress); }));
      var difficulty = LMS.modeValue(g.testedRaws.map(function (r) { return LMS.toStr(r.test_difficulty); }));
      var max = LMS.modeValue(g.testedRaws.map(function (r) { return LMS.toStr(r.test_max_score); }));
      var session = find(g.date, g.classId);
      if (progress) fields.progress = progress;
      if (difficulty) fields.test_difficulty = difficulty;
      // A partial batch must not move the class max; it only seeds an empty one.
      if (max && !(session && !LMS.isBlank(session.test_max_score))) fields.test_max_score = LMS.toNum(max);
      if (Object.keys(fields).length) {
        var prevProgress = session ? LMS.toStr(session.progress) : '';
        fields.lesson_date = g.date;
        fields.class_id = g.classId;
        session = upsert(fields);
        syncClassProgress(session, prevProgress);
      }
      var homework = LMS.modeValue(g.raws.map(function (r) { return LMS.toStr(r.homework); }));
      var titles = LMS.splitHomeworkLines(homework);
      if (titles.length && homeworkItems(g.date, g.classId).length &&
          LMS.joinHomeworkTitles(titles.map(function (t) { return { title: t }; })) !== homeworkText(g.date, g.classId)) {
        ctx.saveHomework(g.date, g.classId, titles);
      }
      copyToLessons(g.date, g.classId, homework ? { homework: homework } : {});
    });
  }

  /** After the date's checklist changed: every student lesson carries the checklist text. */
  function afterHomeworkChanged(date, classId) {
    var lessons = table('Lessons');
    var changed = false;
    var text = LMS.joinHomeworkTitles(homeworkItems(date, classId));
    lessons.forEach(function (row) {
      if (LMS.toStr(row.lesson_date) !== LMS.toStr(date)) return;
      if (LMS.toStr(row.class_id) !== LMS.toStr(classId)) return;
      if (LMS.toStr(row.homework) === text) return;
      row.homework = text;
      row.updated_at = ctx.now();
      changed = true;
    });
    if (changed) saveTable('Lessons', lessons);
  }

  /** v4 migration: re-align drifted student copies with the class record, never moving max scores. */
  function realign(date, classId) {
    copyToLessons(date, classId, { realign: true });
  }

  return {
    find: find,
    homeworkItems: homeworkItems,
    saveSession: saveSession,
    saveNotice: saveNotice,
    afterLessonsSaved: afterLessonsSaved,
    afterHomeworkChanged: afterHomeworkChanged,
    realign: realign
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}

import { LMS, useFileStore, withService } from './store.js';

/** Session lifetime in seconds; the cookie's maxAge and the server-side check share it. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

// Clock skew allowed for `at` slightly in the future (another instance's clock).
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function versionOf(settings) {
  const value = settings && settings.session_version;
  return String(value == null || value === '' ? '0' : value);
}

/** Settings.session_version; sessions signed with another version are logged out. Blank: '0'. */
export async function readSessionVersion() {
  if (useFileStore()) return withService((api) => versionOf(api.getSettings()));
  const { getSql } = await import('./db.js');
  // One row, no advisory lock: this runs on every authenticated request.
  const [row] = await getSql()`select rows from lms.kv where name = 'Settings'`;
  return versionOf(LMS.settingsFromRows(row && Array.isArray(row.rows) ? row.rows : []));
}

/** Logs out every session by moving Settings.session_version on; returns the new version. */
export async function bumpSessionVersion() {
  return withService((api) => {
    const next = String((Number(versionOf(api.getSettings())) || 0) + 1);
    api.saveSettings({ session_version: next });
    return next;
  });
}

/**
 * Whether a decoded session cookie payload still counts: a session (ok, not an OAuth token),
 * signed at `at` less than SESSION_MAX_AGE ago, with the current version. Cookies from before
 * versions existed carry no `sv` and count as version '0'.
 */
export function sessionValid(payload, version, now = Date.now()) {
  if (!payload || payload.ok !== true || payload.typ !== undefined) return false;
  const at = Number(payload.at);
  if (!Number.isFinite(at) || at > now + FUTURE_SKEW_MS || now - at >= SESSION_MAX_AGE * 1000) return false;
  return String(payload.sv ?? '0') === String(version);
}

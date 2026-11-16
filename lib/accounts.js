import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { loadEnv } from './env.js';
import { hashPassword, verifyPassword, passwordProblem, MIN_PASSWORD_LENGTH } from './password.js';
import { DEFAULT_WORKSPACE_ID, isWorkspaceId as isUuid, useFileStore } from './store.js';

loadEnv();

const require = createRequire(import.meta.url);

export { DEFAULT_WORKSPACE_ID, hashPassword, verifyPassword, passwordProblem, MIN_PASSWORD_LENGTH };

export const ROLES = ['admin', 'teacher'];
export const INVITE_TTL_HOURS = 72;
export const RESET_TTL_HOURS = 24;
const DEFAULT_WORKSPACE_NAME = '기본 작업공간';

/** An error whose message is safe to show the user. */
function accountError(message, code = 'ACCOUNT_ERROR') {
  const e = new Error(message);
  e.expose = true;
  e.code = code;
  return e;
}

export function normalizeEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254 ? s : '';
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name || '',
    role: row.role,
    disabled: !!row.disabled,
    session_version: Number(row.session_version),
    token_version: Number(row.token_version ?? 1),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value || null;
}

// ---------- Postgres backend ----------

function pgOps(sql) {
  const one = (rows) => rows[0] || null;
  return {
    async lockAccounts() {
      await sql`select pg_advisory_xact_lock(872164)`;
    },
    // Whether lms.kv is keyed by (workspace_id, name): true once supabase/rollout/20261114_accounts_contract.sql ran.
    async kvPerWorkspace() {
      const cols = await sql`
        select a.attname::text as name
        from pg_index i
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
        where i.indrelid = 'lms.kv'::regclass and i.indisprimary
      `;
      return cols.some((c) => c.name === 'workspace_id');
    },
    async countUsers() {
      return one(await sql`select count(*)::int as n from lms.users`).n;
    },
    async countActiveAdmins() {
      return one(await sql`select count(*)::int as n from lms.users where role = 'admin' and not disabled`).n;
    },
    async userByEmail(email) {
      return one(await sql`select * from lms.users where lower(email) = ${email}`);
    },
    async userById(id) {
      return one(await sql`select * from lms.users where id = ${id}`);
    },
    async listUsers() {
      return sql`
        select u.*, coalesce(
          json_agg(json_build_object('id', w.id, 'name', w.name, 'role', m.role) order by m.created_at)
            filter (where w.id is not null), '[]'::json) as workspaces
        from lms.users u
        left join lms.workspace_members m on m.user_id = u.id
        left join lms.workspaces w on w.id = m.workspace_id
        group by u.id
        order by u.created_at
      `;
    },
    async insertUser({ email, password_hash, name, role }) {
      return one(await sql`
        insert into lms.users (email, password_hash, name, role)
        values (${email}, ${password_hash}, ${name}, ${role})
        returning *
      `);
    },
    async memberUser(userId, workspaceId) {
      return one(await sql`
        select u.* from lms.users u
        join lms.workspace_members m on m.user_id = u.id
        where u.id = ${userId} and m.workspace_id = ${workspaceId}
      `);
    },
    async updateUser(id, patch, bump) {
      const cols = Object.keys(patch);
      const session = bump ? 1 : 0;
      const token = bump === 'all' ? 1 : 0;
      return one(cols.length
        ? await sql`update lms.users set ${sql(patch, cols)}, session_version = session_version + ${session}, token_version = token_version + ${token} where id = ${id} returning *`
        : await sql`update lms.users set session_version = session_version + ${session}, token_version = token_version + ${token} where id = ${id} returning *`);
    },
    async ensureWorkspace(id, name) {
      await sql`insert into lms.workspaces (id, name) values (${id}, ${name}) on conflict (id) do nothing`;
    },
    async insertWorkspace(name) {
      return one(await sql`insert into lms.workspaces (name) values (${name}) returning *`);
    },
    async addMember(workspaceId, userId, role) {
      await sql`
        insert into lms.workspace_members (workspace_id, user_id, role)
        values (${workspaceId}, ${userId}, ${role})
        on conflict (workspace_id, user_id) do nothing
      `;
    },
    async workspacesOf(userId) {
      return sql`
        select w.id, w.name, m.role
        from lms.workspace_members m
        join lms.workspaces w on w.id = m.workspace_id
        where m.user_id = ${userId}
        order by m.created_at, w.created_at
      `;
    },
    async closeOpenInvites(purpose, email) {
      await sql`update lms.invites set used_at = now() where purpose = ${purpose} and lower(email) = ${email} and used_at is null`;
    },
    async insertInvite(row) {
      await sql`
        insert into lms.invites (token_hash, purpose, email, name, role, user_id, workspace_id, created_by, expires_at)
        values (${row.token_hash}, ${row.purpose}, ${row.email}, ${row.name}, ${row.role}, ${row.user_id},
                ${row.workspace_id}, ${row.created_by}, ${row.expires_at})
      `;
    },
    async findOpenInvite(tokenHash) {
      return one(await sql`select * from lms.invites where token_hash = ${tokenHash} and used_at is null and expires_at > now()`);
    },
    async claimInvite(tokenHash) {
      return one(await sql`
        update lms.invites set used_at = now()
        where token_hash = ${tokenHash} and used_at is null and expires_at > now()
        returning *
      `);
    }
  };
}

async function pgBackend() {
  const { getSql } = await import('./db.js');
  const sql = getSql();
  return {
    read: (fn) => fn(pgOps(sql)),
    tx: (fn) => sql.begin((tx) => fn(pgOps(tx)))
  };
}

// ---------- Dev file backend (LMS_STORE=file): dev-server/accounts.json ----------

function fileOps(state) {
  const now = () => new Date(Date.now()).toISOString();
  const open = (inv) => !inv.used_at && Date.parse(inv.expires_at) > Date.now();
  const membersOf = (userId) => state.members.filter((m) => m.user_id === userId);
  return {
    lockAccounts() {},
    kvPerWorkspace: () => true,
    countUsers: () => state.users.length,
    countActiveAdmins: () => state.users.filter((u) => u.role === 'admin' && !u.disabled).length,
    userByEmail: (email) => state.users.find((u) => u.email.toLowerCase() === email) || null,
    userById: (id) => state.users.find((u) => u.id === id) || null,
    listUsers: () => state.users.map((u) => ({
      ...u,
      workspaces: membersOf(u.id).map((m) => {
        const w = state.workspaces.find((x) => x.id === m.workspace_id);
        return { id: m.workspace_id, name: w ? w.name : '', role: m.role };
      })
    })),
    insertUser({ email, password_hash, name, role }) {
      const user = { id: crypto.randomUUID(), email, password_hash, name, role, disabled: false, session_version: 1, token_version: 1, created_at: now() };
      state.users.push(user);
      return user;
    },
    memberUser(userId, workspaceId) {
      if (!state.members.some((m) => m.workspace_id === workspaceId && m.user_id === userId)) return null;
      return state.users.find((u) => u.id === userId) || null;
    },
    updateUser(id, patch, bump) {
      const user = state.users.find((u) => u.id === id);
      if (!user) return null;
      Object.assign(user, patch);
      if (bump) user.session_version += 1;
      if (bump === 'all') user.token_version = (user.token_version ?? 1) + 1;
      return user;
    },
    ensureWorkspace(id, name) {
      if (!state.workspaces.some((w) => w.id === id)) state.workspaces.push({ id, name, created_at: now() });
    },
    insertWorkspace(name) {
      const ws = { id: crypto.randomUUID(), name, created_at: now() };
      state.workspaces.push(ws);
      return ws;
    },
    addMember(workspaceId, userId, role) {
      if (!state.members.some((m) => m.workspace_id === workspaceId && m.user_id === userId)) {
        state.members.push({ workspace_id: workspaceId, user_id: userId, role, created_at: now() });
      }
    },
    workspacesOf: (userId) => membersOf(userId).map((m) => {
      const w = state.workspaces.find((x) => x.id === m.workspace_id);
      return { id: m.workspace_id, name: w ? w.name : '', role: m.role };
    }),
    closeOpenInvites(purpose, email) {
      state.invites.forEach((inv) => {
        if (inv.purpose === purpose && inv.email.toLowerCase() === email && !inv.used_at) inv.used_at = now();
      });
    },
    insertInvite(row) {
      state.invites.push({ ...row, expires_at: toIso(row.expires_at), used_at: null, created_at: now() });
    },
    findOpenInvite: (tokenHash) => state.invites.find((inv) => inv.token_hash === tokenHash && open(inv)) || null,
    claimInvite(tokenHash) {
      const inv = state.invites.find((x) => x.token_hash === tokenHash && open(x));
      if (!inv) return null;
      inv.used_at = now();
      return inv;
    }
  };
}

function fileBackend() {
  const fs = require('node:fs');
  const path = require('node:path');
  const file = path.join(process.cwd(), 'dev-server', 'accounts.json');
  const load = () => {
    const empty = { users: [], workspaces: [], members: [], invites: [] };
    if (!fs.existsSync(file)) return empty;
    try {
      return Object.assign(empty, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      return empty;
    }
  };
  return {
    read: async (fn) => fn(fileOps(load())),
    async tx(fn) {
      const state = load();
      const result = await fn(fileOps(state));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
      return result;
    }
  };
}

async function backend() {
  return useFileStore() ? fileBackend() : pgBackend();
}

async function read(fn) {
  return (await backend()).read(fn);
}

async function tx(fn) {
  return (await backend()).tx(fn);
}

// ---------- Users & sessions ----------

export async function getUser(userId) {
  if (!isUuid(userId)) return null;
  return publicUser(await read((b) => b.userById(userId)));
}

export async function findUserByEmail(email) {
  const e = normalizeEmail(email);
  return e ? publicUser(await read((b) => b.userByEmail(e))) : null;
}

/** Every user with their workspaces ({ id, name, role }), oldest first. */
export async function listUsers() {
  const rows = await read((b) => b.listUsers());
  return rows.map((row) => ({ ...publicUser(row), workspaces: row.workspaces || [] }));
}

export async function workspacesOf(userId) {
  if (!isUuid(userId)) return [];
  return read((b) => b.workspacesOf(userId));
}

/** The active user `uid` as a member of workspace `wid` (one query), or null. */
async function activeMember(uid, wid) {
  if (!isUuid(uid) || !isUuid(wid)) return null;
  const user = publicUser(await read((b) => b.memberUser(uid, wid)));
  return user && !user.disabled ? user : null;
}

/** The user behind a session cookie, or null when disabled, no longer a member, or signed out by a version bump. */
export async function loadSessionUser({ uid, wid, ver }) {
  const user = await activeMember(uid, wid);
  return user && user.session_version === Number(ver) ? user : null;
}

/**
 * The user behind a Claude connector code or token (uv: their token_version when it was issued), or
 * null when disabled, no longer a member, or the password changed since. Logging out leaves it alone.
 */
export async function loadGrantUser({ uid, wid, uv }) {
  const user = await activeMember(uid, wid);
  return user && user.token_version === Number(uv) ? user : null;
}

function bootstrapPasswordOk(input) {
  const expected = process.env.LMS_PASSWORD || '';
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Email + password login. Returns { user, workspaceId } or null.
 * While no account exists, ADMIN_EMAIL + LMS_PASSWORD creates the first admin (owner of the default workspace),
 * provided LMS_PASSWORD passes passwordProblem; otherwise the login just fails and the reason is logged.
 */
export async function authenticate(email, password) {
  const e = normalizeEmail(email);
  const pw = String(password || '');
  if (!e || !pw) return null;
  const user = await read((b) => b.userByEmail(e));
  if (!user) {
    const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
    if (adminEmail && e === adminEmail && bootstrapPasswordOk(pw)) {
      try {
        return await bootstrapAdmin({ email: e, password: pw });
      } catch (err) {
        if (!err.expose) throw err;
        console.warn(`[accounts] first admin not created from ADMIN_EMAIL + LMS_PASSWORD: ${err.message}`);
      }
    }
    await verifyPassword(pw, null);
    return null;
  }
  if (!(await verifyPassword(pw, user.password_hash)) || user.disabled) return null;
  const workspaces = await read((b) => b.workspacesOf(user.id));
  if (!workspaces.length) return null;
  return { user: publicUser(user), workspaceId: workspaces[0].id };
}

/** Creates the first admin as owner of the default workspace (which holds pre-account data). Only while no user exists. */
export async function bootstrapAdmin({ email, password, name = '' }) {
  const e = normalizeEmail(email);
  if (!e) throw accountError('이메일 형식이 올바르지 않습니다.');
  const problem = passwordProblem(password);
  if (problem) throw accountError(problem);
  const passwordHash = await hashPassword(password);
  return tx(async (b) => {
    await b.lockAccounts();
    if ((await b.countUsers()) > 0) throw accountError('이미 계정이 있습니다. 관리자 초대를 이용해 주세요.');
    await b.ensureWorkspace(DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME);
    const user = await b.insertUser({ email: e, password_hash: passwordHash, name: String(name || '').trim().slice(0, 50), role: 'admin' });
    await b.addMember(DEFAULT_WORKSPACE_ID, user.id, 'owner');
    return { user: publicUser(user), workspaceId: DEFAULT_WORKSPACE_ID };
  });
}

/** Changes a password, signs the user out everywhere and cuts their Claude connectors. */
export async function setPassword(userId, password) {
  if (!isUuid(userId)) throw accountError('계정을 찾을 수 없습니다.');
  const problem = passwordProblem(password);
  if (problem) throw accountError(problem);
  const passwordHash = await hashPassword(password);
  const user = await tx((b) => b.updateUser(userId, { password_hash: passwordHash }, 'all'));
  if (!user) throw accountError('계정을 찾을 수 없습니다.');
  return publicUser(user);
}

/** Signs a user out of the web app on every device by moving their session version on. Claude connectors stay. */
export async function signOutEverywhere(userId) {
  if (!isUuid(userId)) return;
  await tx((b) => b.updateUser(userId, {}, 'session'));
}

/**
 * Disables (signs out and cuts connectors at once) or re-enables a user. The last active admin cannot be
 * disabled, and neither can actorId (the admin doing it) disable their own account.
 */
export async function setUserDisabled(userId, disabled, { actorId = null } = {}) {
  if (!isUuid(userId)) throw accountError('계정을 찾을 수 없습니다.');
  return tx(async (b) => {
    await b.lockAccounts();
    const user = await b.userById(userId);
    if (!user) throw accountError('계정을 찾을 수 없습니다.');
    if (disabled && actorId && String(user.id).toLowerCase() === String(actorId).toLowerCase()) {
      throw accountError('지금 로그인한 내 계정은 비활성화할 수 없습니다.');
    }
    if (disabled && user.role === 'admin' && !user.disabled && (await b.countActiveAdmins()) <= 1) {
      throw accountError('마지막 관리자 계정은 비활성화할 수 없습니다.');
    }
    return publicUser(await b.updateUser(userId, { disabled: !!disabled }, 'all'));
  });
}

// ---------- Invites & password reset links ----------

const KV_NOT_READY_MESSAGE = '새 작업공간은 계정 마이그레이션 2단계(supabase/rollout/20261114_accounts_contract.sql)를 적용한 뒤에 만들 수 있습니다.';

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function expiry(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/**
 * One-time invite link for a new user. Without workspaceId the user gets a new workspace of their own;
 * with it, they join that workspace as a member. Earlier open invites for the email stop working
 * (one invite or reset link is made at a time, so two clicks cannot leave two live links).
 * A new workspace needs lms.kv keyed per workspace, so that invite is refused until the contract SQL ran.
 * Returns { token, path, expiresAt }; only the token's hash is stored.
 */
export async function createInvite({ email, name = '', role = 'teacher', createdBy = null, workspaceId = null, ttlHours = INVITE_TTL_HOURS }) {
  const e = normalizeEmail(email);
  if (!e) throw accountError('이메일 형식이 올바르지 않습니다.');
  if (!ROLES.includes(role)) throw accountError('역할이 올바르지 않습니다.');
  if (workspaceId !== null && !isUuid(workspaceId)) throw accountError('작업공간을 찾을 수 없습니다.');
  const token = newToken();
  const expiresAt = expiry(ttlHours);
  await tx(async (b) => {
    await b.lockAccounts();
    if (await b.userByEmail(e)) throw accountError('이미 등록된 이메일입니다.', 'EMAIL_TAKEN');
    if (workspaceId === null && !(await b.kvPerWorkspace())) throw accountError(KV_NOT_READY_MESSAGE, 'KV_NOT_READY');
    await b.closeOpenInvites('invite', e);
    await b.insertInvite({
      token_hash: hashToken(token), purpose: 'invite', email: e, name: String(name || '').trim().slice(0, 50), role,
      user_id: null, workspace_id: workspaceId, created_by: createdBy, expires_at: expiresAt
    });
  });
  return { token, path: `/invite/${token}`, expiresAt: expiresAt.toISOString() };
}

/** One-time password reset link for an existing user. Earlier open reset links stop working. */
export async function createPasswordReset({ userId, createdBy = null, ttlHours = RESET_TTL_HOURS }) {
  if (!isUuid(userId)) throw accountError('계정을 찾을 수 없습니다.');
  const token = newToken();
  const expiresAt = expiry(ttlHours);
  await tx(async (b) => {
    await b.lockAccounts();
    const user = await b.userById(userId);
    if (!user) throw accountError('계정을 찾을 수 없습니다.');
    const email = user.email.toLowerCase();
    await b.closeOpenInvites('reset', email);
    await b.insertInvite({
      token_hash: hashToken(token), purpose: 'reset', email, name: user.name || '', role: user.role,
      user_id: user.id, workspace_id: null, created_by: createdBy, expires_at: expiresAt
    });
  });
  return { token, path: `/invite/${token}`, expiresAt: expiresAt.toISOString() };
}

/** { purpose, email, name, role, expires_at } for a usable link, else null. Does not consume it. */
export async function peekInvite(token) {
  if (!token) return null;
  const inv = await read((b) => b.findOpenInvite(hashToken(token)));
  if (!inv) return null;
  return { purpose: inv.purpose, email: inv.email, name: inv.name || '', role: inv.role, expires_at: toIso(inv.expires_at) };
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const INVITE_INVALID_MESSAGE = '링크가 만료되었거나 이미 사용되었습니다. 관리자에게 새 링크를 요청해 주세요.';

/**
 * Uses an invite or reset link once: sets the password (new user, or existing user signed out elsewhere).
 * Returns { user, workspaceId } for the new session. Unknown tokens are refused before scrypt runs.
 */
export async function acceptInvite(token, { password, name } = {}, { hash = hashPassword } = {}) {
  const tokenHash = hashToken(token);
  if (!TOKEN_RE.test(String(token || '')) || !(await read((b) => b.findOpenInvite(tokenHash)))) {
    throw accountError(INVITE_INVALID_MESSAGE, 'INVITE_INVALID');
  }
  // After the link: a dead link says so, whatever was typed. Before the claim: a weak password leaves it open.
  const problem = passwordProblem(password);
  if (problem) throw accountError(problem, 'WEAK_PASSWORD');
  const passwordHash = await hash(password);
  return tx(async (b) => {
    await b.lockAccounts();
    const inv = await b.claimInvite(tokenHash);
    if (!inv) throw accountError(INVITE_INVALID_MESSAGE, 'INVITE_INVALID');
    if (inv.purpose === 'reset') {
      const user = await b.userById(inv.user_id);
      if (!user || user.disabled) throw accountError('사용할 수 없는 계정입니다.');
      const updated = await b.updateUser(user.id, { password_hash: passwordHash }, 'all');
      const workspaces = await b.workspacesOf(user.id);
      if (!workspaces.length) throw accountError('연결된 작업공간이 없습니다. 관리자에게 문의해 주세요.');
      return { user: publicUser(updated), workspaceId: workspaces[0].id };
    }
    if (await b.userByEmail(inv.email.toLowerCase())) throw accountError('이미 등록된 이메일입니다.', 'EMAIL_TAKEN');
    // Thrown inside the transaction, so the link stays open for later.
    if (!inv.workspace_id && !(await b.kvPerWorkspace())) throw accountError(KV_NOT_READY_MESSAGE, 'KV_NOT_READY');
    const displayName = String(name || inv.name || '').trim().slice(0, 50);
    const user = await b.insertUser({ email: inv.email, password_hash: passwordHash, name: displayName, role: inv.role });
    let workspaceId = inv.workspace_id;
    if (workspaceId) {
      await b.addMember(workspaceId, user.id, 'member');
    } else {
      const ws = await b.insertWorkspace(`${displayName || inv.email} 작업공간`);
      workspaceId = ws.id;
      await b.addMember(workspaceId, user.id, 'owner');
    }
    return { user: publicUser(user), workspaceId };
  });
}

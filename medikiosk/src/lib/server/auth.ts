import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { Role, StaffUser } from "@/lib/types";
import { sessionCookieName } from "@/lib/cookieName";
import { sessionSecret } from "@/lib/server/secret";

/**
 * Lightweight demo authentication.
 *
 * - Passwords hashed with scrypt + per-user salt (no external deps).
 * - Stateless signed session tokens (HMAC-SHA256), delivered as an httpOnly cookie.
 * - Routes enforce auth via `requireUser()`; page redirects are handled by proxy.ts.
 *
 * For production, swap this module for NextAuth / a real IdP.
 */

const DATA_DIR = process.env.MEDIKIOSK_DATA_DIR || path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

export const SESSION_COOKIE = sessionCookieName();

export type User = {
  username: string;
  name: string;
  role: Role;
  department?: string;
  room?: string;
  hprId?: string;
  councilReg?: string;
  qualifications?: string;
  hash: string;
  salt: string;
};

export type SessionUser = StaffUser;

// The secret is resolved lazily inside each function via sessionSecret():
// that helper returns a real secret, throws in production when absent, and
// otherwise falls back to a generated dev secret — never to a published
// literal. Lazy resolution also keeps `next build` (which sets
// NODE_ENV=production) from throwing merely by importing this module.

// ---------------------------------------------------------------- users

const DEFAULT_USERS: Array<{
  username: string;
  name: string;
  role: Role;
  department?: string;
  room?: string;
  hprId?: string;
  councilReg?: string;
  qualifications?: string;
  password: string;
}> = [
  {
    username: "doctor",
    name: "Dr. Ramesh Sharma",
    role: "doctor",
    department: "AYUSH - Ayurveda (General)",
    room: "OPD Room 4 (Ayurveda / Medicine)",
    hprId: "91-7482-1948-2831",
    councilReg: "AYUSH-UP-2016-48291",
    qualifications: "BAMS, MD (Kaya Chikitsa)",
    password: "doctor123",
  },
  {
    username: "doctor_allo",
    name: "Dr. Priya Mehta",
    role: "doctor",
    department: "General Medicine",
    room: "OPD Room 1 (Internal Medicine)",
    hprId: "91-3829-1049-5832",
    councilReg: "NMC-2014-83921",
    qualifications: "MBBS, MD (General Medicine)",
    password: "doctor123",
  },
  {
    username: "nurse",
    name: "Nurse Sunita Verma",
    role: "nurse",
    department: "Triage & Emergency",
    room: "Triage Desk 1",
    hprId: "91-9921-3821-4821",
    councilReg: "INC-DEL-2019-9281",
    qualifications: "B.Sc Nursing (Critical Care)",
    password: "nurse123",
  },
  {
    username: "pharmacist",
    name: "Pharmacist Anil Kumar",
    role: "pharmacist",
    department: "Jan Aushadhi / Dispensary",
    room: "Dispensary Counter 2",
    hprId: "91-5829-2819-4829",
    councilReg: "PCI-UP-2017-38291",
    qualifications: "B.Pharm (Reg. Pharmacist)",
    password: "pharm123",
  },
  {
    username: "admin",
    name: "Dr. S. K. Mukherjee",
    role: "admin",
    department: "Administration",
    room: "Medical Superintendent Office",
    hprId: "91-1002-3921-0029",
    councilReg: "NMC-1998-10293",
    qualifications: "MBBS, MHA (Medical Superintendent)",
    password: "admin123",
  },
  {
    username: "cho",
    name: "Kavita Devi (CHO)",
    role: "nurse",
    department: "Field Outreach",
    room: "Health & Wellness Sub-Centre",
    hprId: "91-4829-1940-2819",
    councilReg: "INC-2020-48291",
    qualifications: "Community Health Officer (CHO / ASHA)",
    password: "camp123",
  },
];

const DEFAULT_PASSWORD_BY_USER = new Map(DEFAULT_USERS.map((u) => [u.username, u.password]));

/**
 * Demo accounts exist so the project is usable the moment it is cloned. Their
 * passwords are published in the README, so seeding them in production would
 * ship known credentials for a clinical system. In production the store
 * starts empty and the first account comes from the /setup wizard
 * (`setupInitialAdmin`), so nothing is ever reachable with a published secret.
 */
function seedingDemoAccounts(): boolean {
  return process.env.NODE_ENV !== "production";
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

async function ensureUsersFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(USERS_FILE);
  } catch {
    const seeded: User[] = seedingDemoAccounts()
      ? DEFAULT_USERS.map((u) => {
          const salt = randomBytes(16).toString("hex");
          return {
            username: u.username,
            name: u.name,
            role: u.role,
            department: u.department,
            room: u.room,
            hprId: u.hprId,
            councilReg: u.councilReg,
            qualifications: u.qualifications,
            salt,
            hash: hashPassword(u.password, salt),
          };
        })
      : [];
    await fs.writeFile(USERS_FILE, JSON.stringify(seeded, null, 2), "utf8");
  }
}

export async function findUser(username: string): Promise<User | null> {
  await ensureUsersFile();
  try {
    const raw = await fs.readFile(USERS_FILE, "utf8");
    const users = JSON.parse(raw) as User[];
    return users.find((u) => u.username === username.toLowerCase()) ?? null;
  } catch {
    return null;
  }
}

export async function verifyCredentials(
  username: string,
  password: string
): Promise<SessionUser | null> {
  const user = await findUser(username);
  if (!user) return null;
  // Belt and braces for a store seeded before this policy existed, or restored
  // from a backup taken on a demo build: a demo password never opens a session
  // in production, whatever the stored hash says.
  if (!seedingDemoAccounts() && DEFAULT_PASSWORD_BY_USER.get(user.username) === password) {
    return null;
  }
  const candidate = Buffer.from(hashPassword(password, user.salt), "hex");
  const expected = Buffer.from(user.hash, "hex");
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
    return null;
  }
  return {
    username: user.username,
    name: user.name,
    role: user.role,
    department: user.department,
    room: user.room,
    hprId: user.hprId,
    councilReg: user.councilReg,
    qualifications: user.qualifications,
  };
}

// ---------------------------------------------------------------- login lockout

const LOCKOUT_FILE = path.join(DATA_DIR, "lockouts.json");
const MAX_FAILURES = 5;
const LOCKOUT_SECONDS = 15 * 60;

type LockState = { fails: number; lockedUntil: number };

async function readLockouts(): Promise<Record<string, LockState>> {
  try {
    const raw = await fs.readFile(LOCKOUT_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, LockState>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function writeLockouts(map: Record<string, LockState>): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(LOCKOUT_FILE, JSON.stringify(map, null, 2), "utf8").catch(() => {});
}

/** Seconds remaining until the account unlocks, or 0 when not locked. */
export async function loginLockedSeconds(username: string, scope = ""): Promise<number> {
  const map = await readLockouts();
  const state = map[lockoutKey(username, scope)];
  if (!state || state.lockedUntil <= Date.now()) return 0;
  return Math.ceil((state.lockedUntil - Date.now()) / 1000);
}

export async function registerLoginFailure(username: string, scope = ""): Promise<void> {
  const key = lockoutKey(username, scope);
  const map = await readLockouts();
  const prev = map[key] ?? { fails: 0, lockedUntil: 0 };
  const fails = prev.fails + 1;
  // Lockout keyed per (username, IP) so one client can't lock out a shared
  // account used by a ward station. Once locked, the ORIGINAL release time is
  // kept — repeated failures during the lock never extend it, and a login that
  // merely bumps the counter can't create a brand-new lock.
  map[key] =
    fails >= MAX_FAILURES
      ? {
          fails,
          lockedUntil:
            prev.lockedUntil > Date.now()
              ? prev.lockedUntil
              : Date.now() + LOCKOUT_SECONDS * 1000,
        }
      : { fails, lockedUntil: prev.lockedUntil };
  await writeLockouts(map);
}

export async function clearLoginFailures(username: string, scope = ""): Promise<void> {
  const map = await readLockouts();
  delete map[lockoutKey(username, scope)];
  await writeLockouts(map);
}

function lockoutKey(username: string, scope = ""): string {
  return `${username.toLowerCase()}|${scope ?? ""}`;
}

// ---------------------------------------------------------------- sessions (revocable)

const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

type ActiveSession = { hash: string; username: string; exp: number; createdAt: number };

function tokenHash(token: string): string {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

async function readSessions(): Promise<ActiveSession[]> {
  try {
    const raw = await fs.readFile(SESSIONS_FILE, "utf8");
    const parsed = JSON.parse(raw) as ActiveSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeSessions(list: ActiveSession[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(list, null, 2), "utf8").catch(() => {});
}

/** Record the issued token so logout actually revokes it. */
export async function registerSession(token: string, user: SessionUser): Promise<void> {
  const list = await readSessions();
  // Prune EVERY expired session, not just this user's: otherwise dead entries
  // for users who never log in again accumulate in sessions.json forever and
  // every authentication check pays to read and scan them.
  const live = list.filter((s) => s.exp > Date.now());
  live.push({ hash: tokenHash(token), username: user.username, exp: Date.now() + 8 * 60 * 60 * 1000, createdAt: Date.now() });
  await writeSessions(live);
}

/** Token still on the active list and not expired? */
export async function sessionIsActive(token: string): Promise<boolean> {
  const hash = tokenHash(token);
  const list = await readSessions();
  const found = list.find((s) => s.hash === hash);
  if (!found) return false;
  if (found.exp <= Date.now()) {
    await writeSessions(list.filter((s) => s.hash !== hash)).catch(() => {});
    return false;
  }
  return true;
}

/** Remove a token from the active list (logout / revocation). */
export async function revokeSession(token: string): Promise<void> {
  const hash = tokenHash(token);
  const list = await readSessions();
  await writeSessions(list.filter((s) => s.hash !== hash));
}

/**
 * Remove EVERY session belonging to a user.
 *
 * Logout on a shared terminal must end the user's sessions everywhere, not
 * just the tab that signed out — otherwise a session left open on another
 * station (or a copied cookie) stays valid for up to 8 hours after the user
 * believes they signed out.
 */
export async function revokeUserSessions(username: string): Promise<void> {
  const list = await readSessions();
  const key = username.toLowerCase();
  await writeSessions(list.filter((s) => s.username.toLowerCase() !== key));
}

// ---------------------------------------------------------------- tokens

type TokenPayload = {
  sub: string;
  name: string;
  role: Role;
  department?: string;
  room?: string;
  hprId?: string;
  councilReg?: string;
  qualifications?: string;
  exp: number;
};

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export function signToken(user: SessionUser, ttlSeconds = 60 * 60 * 8): string {
  const payload: TokenPayload = {
    sub: user.username,
    name: user.name,
    role: user.role,
    department: user.department,
    room: user.room,
    hprId: user.hprId,
    councilReg: user.councilReg,
    qualifications: user.qualifications,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (!["doctor", "nurse", "pharmacist", "admin"].includes(payload.role)) return null;
    return {
      username: payload.sub,
      name: payload.name,
      role: payload.role,
      department: payload.department,
      room: payload.room,
      hprId: payload.hprId,
      councilReg: payload.councilReg,
      qualifications: payload.qualifications,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- first-run setup

/**
 * First-run wizard (Batch C, P5): install the username + password chosen at
 * setup as the site's admin account. In production no demo accounts were ever
 * seeded, so this is the only way an admin exists; in development the other
 * demo roles (doctor/nurse/pharmacist) are left intact so the demo stays usable
 * after configuration. Idempotent: calling it against an already-configured
 * site just re-hashes the caller's credentials — the route guards against that,
 * this function doesn't.
 */
export async function setupInitialAdmin(username: string, password: string): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  let users: User[] = [];
  try {
    const parsed = JSON.parse(await fs.readFile(USERS_FILE, "utf8"));
    users = Array.isArray(parsed) ? (parsed as User[]) : [];
  } catch {
    users = [];
  }
  const salt = randomBytes(16).toString("hex");
  const next: User[] = [
    ...users.filter((u) => u.role !== "admin"),
    {
      username: username.toLowerCase(),
      name: "Hospital Admin",
      role: "admin",
      salt,
      hash: hashPassword(password, salt),
    },
  ];
  await fs.writeFile(USERS_FILE, JSON.stringify(next, null, 2), "utf8");
}

export function sessionCookieValue(): {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
  secure?: boolean;
} {
  return {
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/" as const,
    maxAge: 60 * 60 * 8,
    // Secure only when explicitly opted in (or already forced by the __Host-
    // prefix). Never inferred from NODE_ENV: `next start --production` over
    // plain http must still hand out a usable cookie in this demo.
    secure:
      process.env.MEDIKIOSK_SECURE_COOKIE === "1" ||
      process.env.MEDIKIOSK_HOST_COOKIE_PREFIX === "1",
  };
}

// ---------------------------------------------------------------- route guard helper

/** Reads the session from the request cookie. Returns null when not authenticated. */
export async function currentUser(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const user = verifyToken(token);
    if (!user) return null;
    // Enforce the server-side allow-list so logout/revocation actually works.
    if (!(await sessionIsActive(token))) return null;
    return user;
  } catch {
    return null;
  }
}
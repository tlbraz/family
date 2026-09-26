import { randomUUID } from 'node:crypto';
import { and, eq, gte, isNull, or, isNotNull } from 'drizzle-orm';
import { JWT } from 'google-auth-library';
import type { Db } from '../db';
import { eventParticipants, events, members, settings } from '../schema';
import { dateKey, parseDateKey } from './time';

// Two-way sync with one shared "Family" Google Calendar, owned by a Google service account
// and shared (writer) with each parent's Google account. Parents subscribe on their phones
// and get Google's normal notifications. Off until a service account key is pasted on the Family page
// (or set as GOOGLE_SERVICE_ACCOUNT).
//
// Rules: the app is the source of truth for events made in the app; from Google we only take
// their deletion or a changed time. Events made in Google are imported (and kept up to date).

const API = 'https://www.googleapis.com/calendar/v3';
const TZ = 'Europe/Lisbon';
const COLOR: Record<string, string> = { medical: '11', sports: '10', school: '9', party: '4', family: '5', work: '8', holiday: '7', other: '1' };
const EMOJI: Record<string, string> = { medical: '🩺', sports: '⚽', school: '🎒', party: '🎉', family: '🏠', work: '💼', holiday: '🌴', other: '📌' };

// The key comes from the env var or, more usually, from the Family page (stored in settings).
let key: { client_email: string; private_key: string } | null = null;
let jwt: JWT | null = null;

export const googleEnabled = () => !!key;
export const serviceEmail = () => key?.client_email ?? null;

function parseKey(json: string) {
  const k = JSON.parse(json);
  if (typeof k.client_email !== 'string' || typeof k.private_key !== 'string') throw new Error('That is not a service account key file');
  return { client_email: k.client_email, private_key: k.private_key };
}

/** Loads the key at startup: env var first, then the one saved from the Family page. */
export async function loadGoogleKey(db: Db) {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT || (await getSetting(db, 'google:serviceAccount'));
  if (!json) return;
  try {
    key = parseKey(json);
    jwt = null;
  } catch (e) {
    console.error('google key:', (e as Error).message);
  }
}

/** Checks a pasted key against Google and saves it. */
export async function saveGoogleKey(db: Db, json: string) {
  const candidate = parseKey(json);
  const test = new JWT({ email: candidate.client_email, key: candidate.private_key, scopes: ['https://www.googleapis.com/auth/calendar'] });
  await test.getAccessToken(); // throws if Google rejects it
  await setSetting(db, 'google:serviceAccount', JSON.stringify(candidate));
  key = candidate;
  jwt = test;
}

export async function googleStatus(db: Db) {
  const cal = key ? await getSetting(db, 'google:calendarId') : null;
  const shared = (await db.select().from(settings)).filter((r) => r.key.startsWith('google:shared:')).map((r) => r.key.slice(14));
  const lastSync = await getSetting(db, 'google:lastSync');
  const lastError = await getSetting(db, 'google:lastError');
  return { connected: !!key, serviceEmail: key?.client_email ?? null, calendarId: cal, sharedWith: shared, lastSync, lastError };
}

async function call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  if (!key) throw new Error('Google is not connected');
  if (!jwt) jwt = new JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/calendar'] });
  const { token } = await jwt.getAccessToken();
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google ${method} ${path.split('?')[0]} → ${res.status} ${data?.error?.message ?? ''}`);
  }
  return { status: res.status, data };
}

async function getSetting(db: Db, key: string) {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row?.value ?? null;
}
async function setSetting(db: Db, key: string, value: string | null) {
  if (value === null) await db.delete(settings).where(eq(settings.key, key));
  else await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** The shared calendar's id, creating the calendar the first time. */
export async function calendarId(db: Db): Promise<string> {
  const known = process.env.GOOGLE_CALENDAR_ID || (await getSetting(db, 'google:calendarId'));
  if (known) return known;
  const { data } = await call('POST', '/calendars', { summary: 'Family', description: 'Managed by http://family.lan', timeZone: TZ });
  await setSetting(db, 'google:calendarId', data.id);
  return data.id;
}

/** Gives every parent with a Google address write access (Google emails them an invite once). */
export async function shareWithParents(db: Db) {
  const cal = await calendarId(db);
  const parents = await db.select().from(members).where(and(eq(members.role, 'parent'), isNotNull(members.googleEmail)));
  for (const p of parents) {
    const key = `google:shared:${p.googleEmail}`;
    if (await getSetting(db, key)) continue;
    await call('POST', `/calendars/${encodeURIComponent(cal)}/acl?sendNotifications=true`, {
      role: 'writer',
      scope: { type: 'user', value: p.googleEmail },
    });
    await setSetting(db, key, new Date().toISOString());
    console.log(`google: shared the Family calendar with ${p.name}`);
  }
}

function when(allDay: boolean, d: Date) {
  return allDay ? { date: dateKey(d) } : { dateTime: d.toISOString(), timeZone: TZ };
}

/** Creates or updates the Google copy of an app event. */
export async function pushEvent(db: Db, id: string) {
  const [row] = await db.select().from(events).where(eq(events.id, id));
  if (!row) return;
  const cal = await calendarId(db);
  const all = await db.select().from(members);
  const name = new Map(all.map((m) => [m.id, m.name]));
  const people = (await db.select().from(eventParticipants).where(eq(eventParticipants.eventId, id))).map((p) => name.get(p.memberId)).filter(Boolean);

  const description = [
    people.length ? `Who: ${people.join(', ')}` : '',
    row.driverId && name.get(row.driverId) ? `Driver: ${name.get(row.driverId)}` : '',
    row.bring.length ? `Bring: ${row.bring.map((b) => b.text).join(', ')}` : '',
    row.notes ?? '',
    '— family.lan',
  ].filter(Boolean).join('\n');
  const recurrence = row.rrule
    ? [`RRULE:${row.rrule}`, ...row.exdates.map((d) => (row.allDay ? `EXDATE;VALUE=DATE:${dateKey(new Date(d)).replace(/-/g, '')}` : `EXDATE:${new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`))]
    : undefined;
  const body = {
    summary: `${EMOJI[row.type] ?? ''} ${row.title}${people.length ? ` · ${people.join(', ')}` : ''}`.trim(),
    description,
    location: row.location ?? undefined,
    start: when(row.allDay, row.startAt),
    end: when(row.allDay, row.endAt),
    recurrence,
    colorId: COLOR[row.type],
    extendedProperties: { private: { familyId: row.id } },
  };

  let res = row.googleId
    ? await call('PUT', `/calendars/${encodeURIComponent(cal)}/events/${row.googleId}`, body)
    : null;
  if (!res || res.status === 404 || res.status === 410) res = await call('POST', `/calendars/${encodeURIComponent(cal)}/events`, body);
  await db.update(events).set({ googleId: res.data.id, googleSyncedAt: new Date(res.data.updated) }).where(eq(events.id, id));
}

export async function deleteGoogleEvent(db: Db, googleId: string) {
  const cal = await calendarId(db);
  await call('DELETE', `/calendars/${encodeURIComponent(cal)}/events/${googleId}`);
}

/** Pushes app events that have never been synced (e.g. made before Google was connected). */
export async function pushUnsynced(db: Db) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.source, 'app'), isNull(events.googleId), or(gte(events.endAt, since), isNotNull(events.rrule))));
  for (const r of rows) await pushEvent(db, r.id);
}

function parseWhen(w: { date?: string; dateTime?: string }): Date {
  return w.dateTime ? new Date(w.dateTime) : parseDateKey(w.date!);
}

/** Pulls changes made in Google since the last run (incremental via syncToken). */
export async function pull(db: Db) {
  const cal = await calendarId(db);
  let token = await getSetting(db, 'google:syncToken');
  let pageToken: string | undefined;
  const parents = await db.select().from(members).where(isNotNull(members.googleEmail));
  const byEmail = new Map(parents.map((m) => [m.googleEmail!.toLowerCase(), m.id]));

  for (;;) {
    const q = new URLSearchParams({ showDeleted: 'true', maxResults: '250' });
    if (token) q.set('syncToken', token);
    else q.set('timeMin', new Date(Date.now() - 30 * 86_400_000).toISOString());
    if (pageToken) q.set('pageToken', pageToken);
    const res = await call('GET', `/calendars/${encodeURIComponent(cal)}/events?${q}`);
    if (res.status === 410) {
      await setSetting(db, 'google:syncToken', null); // token expired: full resync next time
      return;
    }
    for (const item of res.data.items ?? []) await applyRemote(db, item, byEmail);
    pageToken = res.data.nextPageToken;
    if (!pageToken) {
      if (res.data.nextSyncToken) await setSetting(db, 'google:syncToken', res.data.nextSyncToken);
      return;
    }
    token = token ?? null;
  }
}

async function applyRemote(db: Db, item: any, byEmail: Map<string, number>) {
  if (item.recurringEventId) return; // single-instance edits of a series: not supported yet
  const familyId: string | undefined = item.extendedProperties?.private?.familyId;
  const [local] = familyId
    ? await db.select().from(events).where(eq(events.id, familyId))
    : await db.select().from(events).where(eq(events.googleId, item.id));

  if (item.status === 'cancelled') {
    if (local) await db.delete(events).where(eq(events.id, local.id));
    return;
  }
  const updated = new Date(item.updated);
  if (local?.googleSyncedAt && updated.getTime() <= local.googleSyncedAt.getTime() + 1000) return; // our own write

  const allDay = !!item.start?.date;
  const times = { allDay, startAt: parseWhen(item.start), endAt: parseWhen(item.end) };
  if (local && local.source === 'app') {
    // Made in the app: accept only a new time from Google.
    await db.update(events).set({ ...times, googleSyncedAt: updated, updatedAt: new Date() }).where(eq(events.id, local.id));
    return;
  }
  const rrule = (item.recurrence as string[] | undefined)?.find((r) => r.startsWith('RRULE:'))?.slice(6) ?? null;
  const values = {
    title: item.summary ?? '(no title)',
    type: 'other' as const,
    ...times,
    location: item.location ?? null,
    notes: item.description ?? null,
    rrule,
    source: 'google' as const,
    googleId: item.id,
    googleSyncedAt: updated,
    updatedAt: new Date(),
  };
  if (local) {
    await db.update(events).set(values).where(eq(events.id, local.id));
  } else {
    const id = randomUUID();
    await db.insert(events).values({ id, ...values });
    const creator = byEmail.get(String(item.creator?.email ?? '').toLowerCase());
    if (creator) await db.insert(eventParticipants).values({ eventId: id, memberId: creator });
  }
}

/** One sync round; errors are logged, never thrown. */
export async function syncRound(db: Db) {
  if (!googleEnabled()) return;
  try {
    await shareWithParents(db);
    await pushUnsynced(db);
    await pull(db);
    await setSetting(db, 'google:lastSync', new Date().toISOString());
    await setSetting(db, 'google:lastError', null);
  } catch (e) {
    console.error('google sync:', (e as Error).message);
    await setSetting(db, 'google:lastError', (e as Error).message.slice(0, 300)).catch(() => {});
  }
}

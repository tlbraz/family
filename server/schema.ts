import { boolean, date, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';
import type { BringItem, DocumentKind, EventType, Role } from '../shared/types';

// Fridge notes: short messages for the whole family.
export const notes = pgTable('notes', {
  id: serial('id').primaryKey(),
  text: text('text').notNull(),
  author: text('author'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const members = pgTable('members', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').$type<Role>().notNull(),
  color: text('color').notNull(),
  birthday: date('birthday'),
  googleEmail: text('google_email'),
  passwordHash: text('password_hash'),
  sort: integer('sort').notNull().default(0),
  photoAt: timestamp('photo_at', { withTimezone: true }), // when the photo last changed; null = no photo
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ID numbers and documents. Kept out of the members table because members are readable by anyone;
// these are only ever served to signed-in parents.
export const memberDocuments = pgTable(
  'member_documents',
  {
    id: serial('id').primaryKey(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<DocumentKind>().notNull(),
    label: text('label'),
    number: text('number').notNull().default(''),
    expires: date('expires'),
    link: text('link'),
    note: text('note'),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [index('member_documents_member_idx').on(t.memberId)],
);

// Profile pictures, kept apart so the member rows loaded on every request stay small.
export const memberPhotos = pgTable('member_photos', {
  memberId: integer('member_id')
    .primaryKey()
    .references(() => members.id, { onDelete: 'cascade' }),
  mime: text('mime').notNull(),
  data: text('data').notNull(), // base64
});

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  memberId: integer('member_id')
    .notNull()
    .references(() => members.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    type: text('type').$type<EventType>().notNull(),
    allDay: boolean('all_day').notNull().default(false),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    location: text('location'),
    notes: text('notes'),
    bring: jsonb('bring').$type<BringItem[]>().notNull().default([]),
    reminders: jsonb('reminders').$type<number[]>().notNull().default([]), // minutes before start → Telegram
    rrule: text('rrule'), // e.g. FREQ=WEEKLY;BYDAY=SA — null = one-off
    exdates: jsonb('exdates').$type<string[]>().notNull().default([]), // ISO starts of skipped occurrences
    source: text('source').$type<'app' | 'google'>().notNull().default('app'),
    googleId: text('google_id'),
    googleSyncedAt: timestamp('google_synced_at', { withTimezone: true }),
    createdBy: integer('created_by').references(() => members.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('events_start_idx').on(t.startAt), index('events_google_idx').on(t.googleId)],
);

export const eventParticipants = pgTable(
  'event_participants',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.memberId] })],
);

// Small key/value store: Google sync token, calendar id, last digest sent, …
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// School to-dos: "sign the permission slip by Friday". Shown on the due day and in the evening message.
export const tasks = pgTable(
  'tasks',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    due: date('due').notNull(), // YYYY-MM-DD
    memberId: integer('member_id').references(() => members.id, { onDelete: 'set null' }), // who it's for; null = the family
    done: boolean('done').notNull().default(false),
    doneAt: timestamp('done_at', { withTimezone: true }), // when it was ticked; the calendar hides it the day after
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('tasks_due_idx').on(t.due)],
);

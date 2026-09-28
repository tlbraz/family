// Types shared by the API and the web app.

export interface Health {
  ok: boolean;
  version: string;
  commit: string;
  db: 'up' | 'down';
}

export interface Note {
  id: number;
  text: string;
  author: string | null;
  createdAt: string;
}

export type Role = 'parent' | 'kid';

export interface Member {
  id: number;
  name: string;
  role: Role;
  color: string;
  birthday: string | null; // YYYY-MM-DD
  googleEmail: string | null;
  hasPassword: boolean;
  photo: string | null; // URL of the profile picture
}

export type MemberInput = Omit<Member, 'id' | 'hasPassword' | 'photo'>;

/** Personal documents (parents only). `expires` marks the ones that run out and need renewing. */
export const DOCUMENT_KINDS = {
  cc: { label: 'Cartão de Cidadão', expires: true },
  nif: { label: 'NIF', expires: false },
  niss: { label: 'Segurança Social (NISS)', expires: false },
  sns: { label: 'Nº de utente (SNS)', expires: false },
  passport: { label: 'Passaporte', expires: true },
  driving: { label: 'Carta de condução', expires: true },
  cesd: { label: 'Cartão Europeu de Seguro de Doença', expires: true },
  insurance: { label: 'Seguro de saúde', expires: true },
  other: { label: 'Other', expires: true },
} as const;
export type DocumentKind = keyof typeof DOCUMENT_KINDS;

export interface MemberDocument {
  kind: DocumentKind;
  label: string | null; // the name, for kind "other"
  number: string;
  expires: string | null; // YYYY-MM-DD
  link: string | null; // e.g. the scan in Paperless
  note: string | null;
}

export const EVENT_TYPES = ['medical', 'sports', 'school', 'party', 'family', 'work', 'holiday', 'other'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface BringItem {
  text: string;
  done: boolean;
}

/** Repeat rule kept deliberately small; stored as an iCal RRULE. */
export interface Repeat {
  freq: 'weekly' | 'monthly' | 'yearly';
  interval: number; // every N weeks/months/years
  weekdays?: number[]; // 0 = Monday … 6 = Sunday (weekly only)
  until?: string | null; // YYYY-MM-DD, inclusive
}

/** An event as stored (the series, for repeating events). */
export interface CalendarEvent {
  id: string;
  title: string;
  type: EventType;
  allDay: boolean;
  start: string; // ISO; all-day events start at local midnight
  end: string; // ISO; exclusive
  location: string | null;
  notes: string | null;
  participants: number[];
  bring: BringItem[];
  reminders: number[]; // minutes before the start (negative = after, e.g. -480 = 08:00 on an all-day event)
  repeat: Repeat | null;
  source: 'app' | 'google';
}

export type EventInput = Omit<CalendarEvent, 'id' | 'source'>;

/** One thing on the calendar on a given day: an event occurrence, birthday, holiday or school break. */
export interface Occurrence {
  key: string; // unique per occurrence
  eventId: string | null; // null for generated items (birthdays, holidays)
  kind: 'event' | 'birthday' | 'holiday' | 'school';
  title: string;
  type: EventType | 'birthday';
  allDay: boolean;
  start: string;
  end: string;
  location: string | null;
  participants: number[];
  bring: BringItem[];
  reminders: number[]; // minutes before the start (negative = after, e.g. -480 = 08:00 on an all-day event)
  repeats: boolean;
}

/** Events matching a search; a repeating event shows up once, at its next (or last) date. */
export interface SearchResults {
  upcoming: Occurrence[];
  past: Occurrence[];
}

/** A small to-do with a due date ("pay €10 for the trip by Friday"). */
export interface Task {
  id: number;
  title: string;
  due: string; // YYYY-MM-DD
  memberId: number | null; // who it's for; null = the family
  done: boolean;
  doneAt: string | null; // ISO
}

export type TaskInput = Pick<Task, 'title' | 'due' | 'memberId'>;

export interface AppConfig {
  me: Member | null;
  features: { ai: boolean; google: boolean; telegram: boolean };
}

/** What Claude reads out of a photo or a sentence; the user confirms it in the event form. */
export interface EventDraft {
  title: string;
  type: EventType;
  date: string; // YYYY-MM-DD
  allDay: boolean;
  startTime: string | null; // HH:MM
  endTime: string | null;
  location: string | null;
  participants: string[]; // member names
  bring: string[];
  notes: string | null;
}

export interface GroceryItem {
  id: number;
  text: string;
  section: string; // "Fruit & veg", "Dairy & eggs", … in shop order
  done: boolean;
}

export interface GroceryList {
  items: GroceryItem[];
  sections: string[]; // walking order through the shop
  suggestions: string[]; // bought often, not on the list now
}

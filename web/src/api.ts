import type { AppConfig, CalendarEvent, EventDraft, EventInput, Health, Member, Note, Occurrence } from '../../shared/types';

export interface GoogleStatus {
  connected: boolean;
  serviceEmail: string | null;
  calendarId: string | null;
  sharedWith: string[];
  lastSync: string | null;
  lastError: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok && res.status !== 503) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Something went wrong (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  health: () => request<Health>('/health'),
  config: () => request<AppConfig>('/config'),
  login: (memberId: number, password: string) => request('/auth/login', json('POST', { memberId, password })),
  logout: () => request('/auth/logout', json('POST')),

  members: () => request<Member[]>('/members'),
  addMember: (m: Omit<Member, 'id' | 'hasPassword'>) => request<Member>('/members', json('POST', m)),
  updateMember: (id: number, m: Omit<Member, 'id' | 'hasPassword'>) => request<Member>(`/members/${id}`, json('PATCH', m)),
  deleteMember: (id: number) => request<void>(`/members/${id}`, json('DELETE')),

  calendar: (from: string, to: string) => request<Occurrence[]>(`/calendar?from=${from}&to=${to}`),
  event: (id: string) => request<CalendarEvent>(`/events/${id}`),
  createEvent: (e: EventInput) => request<CalendarEvent>('/events', json('POST', e)),
  updateEvent: (id: string, e: EventInput) => request<CalendarEvent>(`/events/${id}`, json('PATCH', e)),
  deleteEvent: (id: string, occurrence?: string) =>
    request<void>(`/events/${id}${occurrence ? `?occurrence=${encodeURIComponent(occurrence)}` : ''}`, json('DELETE')),
  toggleBring: (id: string, index: number) => request<{ bring: CalendarEvent['bring'] }>(`/events/${id}/bring/${index}`, json('POST')),
  draft: (text: string, image?: { mediaType: string; data: string }) => request<EventDraft>('/ai/event', json('POST', { text, image })),

  googleStatus: () => request<GoogleStatus>('/google'),
  connectGoogle: (key: string) => request<GoogleStatus>('/google', json('POST', { key })),

  notes: () => request<Note[]>('/notes'),
  addNote: (text: string, author: string) => request<Note>('/notes', json('POST', { text, author })),
  deleteNote: (id: number) => request<void>(`/notes/${id}`, json('DELETE')),
};

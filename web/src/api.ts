import type { GroceryList, AppConfig, CalendarEvent, EventDraft, EventInput, Health, Member, MemberDocument, MemberInput, Note, Occurrence, SearchResults, Task, TaskInput } from '../../shared/types';

export interface GoogleStatus {
  connected: boolean;
  serviceEmail: string | null;
  calendarId: string | null;
  sharedWith: string[];
  lastSync: string | null;
  lastError: string | null;
}

export interface TelegramStatus {
  bot: string | null;
  recipients: { id: string; name: string; fixed: boolean }[];
  waiting: { id: string; name: string }[];
  sent?: boolean;
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
  addMember: (m: MemberInput) => request<Member>('/members', json('POST', m)),
  updateMember: (id: number, m: MemberInput) => request<Member>(`/members/${id}`, json('PATCH', m)),
  setPhoto: (id: number, photo: string) => request<Member>(`/members/${id}/photo`, json('PUT', { photo })),
  removePhoto: (id: number) => request<Member>(`/members/${id}/photo`, json('DELETE')),
  documents: (id: number) => request<MemberDocument[]>(`/members/${id}/documents`),
  saveDocuments: (id: number, docs: MemberDocument[]) => request<MemberDocument[]>(`/members/${id}/documents`, json('PUT', docs)),
  deleteMember: (id: number) => request<void>(`/members/${id}`, json('DELETE')),

  calendar: (from: string, to: string) => request<Occurrence[]>(`/calendar?from=${from}&to=${to}`),
  search: (q: string) => request<SearchResults>(`/search?q=${encodeURIComponent(q)}`),
  event: (id: string) => request<CalendarEvent>(`/events/${id}`),
  createEvent: (e: EventInput) => request<CalendarEvent>('/events', json('POST', e)),
  updateEvent: (id: string, e: EventInput) => request<CalendarEvent>(`/events/${id}`, json('PATCH', e)),
  deleteEvent: (id: string, occurrence?: string) =>
    request<void>(`/events/${id}${occurrence ? `?occurrence=${encodeURIComponent(occurrence)}` : ''}`, json('DELETE')),
  toggleBring: (id: string, index: number) => request<{ bring: CalendarEvent['bring'] }>(`/events/${id}/bring/${index}`, json('POST')),
  draft: (text: string, image?: { mediaType: string; data: string }) => request<EventDraft>('/ai/event', json('POST', { text, image })),

  googleStatus: () => request<GoogleStatus>('/google'),
  connectGoogle: (key: string) => request<GoogleStatus>('/google', json('POST', { key })),

  tasks: (from: string, to: string) => request<Task[]>(`/tasks?from=${from}&to=${to}`),
  addTask: (t: TaskInput) => request<Task>('/tasks', json('POST', t)),
  updateTask: (id: number, t: TaskInput) => request<Task>(`/tasks/${id}`, json('PATCH', t)),
  toggleTask: (id: number) => request<Task>(`/tasks/${id}/done`, json('POST')),
  deleteTask: (id: number) => request<void>(`/tasks/${id}`, json('DELETE')),

  telegram: () => request<TelegramStatus>('/telegram'),
  addTelegram: (id: string, name: string) => request<TelegramStatus>('/telegram/chats', json('POST', { id, name })),
  removeTelegram: (id: string) => request<TelegramStatus>(`/telegram/chats/${encodeURIComponent(id)}`, json('DELETE')),

  groceries: () => request<GroceryList>('/groceries'),
  addGroceries: (text: string) => request<GroceryList>('/groceries', json('POST', { text })),
  toggleGrocery: (id: number) => request<GroceryList>(`/groceries/${id}/toggle`, json('POST')),
  moveGrocery: (id: number, section: string) => request<GroceryList>(`/groceries/${id}`, json('PATCH', { section })),
  deleteGrocery: (id: number) => request<GroceryList>(`/groceries/${id}`, json('DELETE')),
  clearGroceries: () => request<GroceryList>('/groceries/clear', json('POST')),

  notes: () => request<Note[]>('/notes'),
  addNote: (text: string, author: string) => request<Note>('/notes', json('POST', { text, author })),
  deleteNote: (id: number) => request<void>(`/notes/${id}`, json('DELETE')),
};

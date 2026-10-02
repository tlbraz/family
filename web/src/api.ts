import type { GroceryList, AppConfig, CalendarEvent, EventDraft, EventInput, Health, Member, MemberDocument, MemberInput, MoneyBudget, MoneyHolding, MoneyHoldings, MoneySummary, PaperlessInbox, DocsMeta, DocsPage, PaperlessDetail, Occurrence, SearchResults, Task, TaskInput } from '../../shared/types';

export interface GoogleStatus {
  connected: boolean;
  serviceEmail: string | null;
  calendarId: string | null;
  sharedWith: string[];
  lastSync: string | null;
  lastError: string | null;
}

import type { BpInput, BpLog, BpReading } from '../../shared/bp';

export interface TelegramStatus {
  bot: string | null;
  recipients: { id: string; name: string; fixed: boolean }[];
  waiting: { id: string; name: string }[];
  sent?: boolean;
}

/** The server is restarting (a new version going live): the proxy answers with plain text, not the app. */
export class DeployingError extends Error {}
export const DEPLOYING_EVENT = 'family:deploying';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (res.status >= 502 && res.status <= 504 && !(res.headers.get('content-type') ?? '').includes('json')) {
    window.dispatchEvent(new Event(DEPLOYING_EVENT));
    throw new DeployingError('The app is updating, back in a moment');
  }
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

  bp: (memberId: number) => request<BpLog>(`/bp/${memberId}`),
  bpSettings: (memberId: number, s: { tracking: boolean; telegramId: string | null }) => request<BpLog>(`/bp/${memberId}/settings`, json('PUT', s)),
  addBp: (memberId: number, r: BpInput) => request<BpReading>(`/bp/${memberId}`, json('POST', r)),
  deleteBp: (memberId: number, id: number) => request<void>(`/bp/${memberId}/readings/${id}`, json('DELETE')),
  bpReportUrl: (memberId: number, from: string, to: string) => `/api/bp/${memberId}/report?from=${from}&to=${to}`,

  telegram: () => request<TelegramStatus>('/telegram'),
  addTelegram: (id: string, name: string) => request<TelegramStatus>('/telegram/chats', json('POST', { id, name })),
  removeTelegram: (id: string) => request<TelegramStatus>(`/telegram/chats/${encodeURIComponent(id)}`, json('DELETE')),

  groceries: () => request<GroceryList>('/groceries'),
  addGroceries: (text: string) => request<GroceryList>('/groceries', json('POST', { text })),
  toggleGrocery: (id: number) => request<GroceryList>(`/groceries/${id}/toggle`, json('POST')),
  moveGrocery: (id: number, section: string) => request<GroceryList>(`/groceries/${id}`, json('PATCH', { section })),
  deleteGrocery: (id: number) => request<GroceryList>(`/groceries/${id}`, json('DELETE')),
  clearGroceries: () => request<GroceryList>('/groceries/clear', json('POST')),

  money: (budget: MoneyBudget, month: string | null) => request<MoneySummary>(`/money?budget=${budget}${month ? `&month=${month}` : ''}`),
  holdings: () => request<MoneyHoldings>('/money/holdings'),
  saveHoldings: (holdings: MoneyHolding[]) => request<MoneyHoldings>('/money/holdings', json('PUT', { holdings })),
  billAction: (action: 'ignore' | 'unignore' | 'track' | 'untrack', key: string, name: string) => request<{ ok: true }>('/money/bills', json('POST', { action, key, name })),
  refreshMoney: () => request<{ ok: true }>('/money/refresh', json('POST')),
  transferMoney: (budget: MoneyBudget, out: string, into: string, action: 'link' | 'ignore') => request<{ ok: true }>('/money/transfer', json('POST', { budget, out, in: into, action })),
  docsMeta: () => request<DocsMeta>('/docs/meta'),
  docs: (q: { q?: string; inbox?: boolean; tag?: number; correspondent?: number; type?: number; page?: number }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== false) p.set(k, v === true ? '1' : String(v));
    return request<DocsPage>(`/docs?${p}`);
  },
  doc: (id: number) => request<PaperlessDetail>(`/docs/${id}`),
  saveDoc: (id: number, change: { tags?: number[]; approve?: boolean }) =>
    request<PaperlessDetail>(`/docs/${id}`, json('PATCH', change)),
  paperless: () => request<PaperlessInbox>('/money/paperless'),
  editMoney: (budget: MoneyBudget, id: string, change: { category?: string; review?: boolean; note?: string }) => request<{ ok: true }>('/money/edit', json('POST', { budget, id, ...change })),

};

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { EVENT_TYPES, type CalendarEvent, type EventDraft, type EventInput, type EventType, type Member, type Occurrence, type Repeat } from '../../../shared/types';
import { api } from '../api';
import { addDays, dateKey, fromKey, pad, timeOf } from '../dates';
import { Avatar, AvatarStack } from './Avatar';
import { Icon, TYPE_LABEL } from './Icon';
import { Sheet } from './Sheet';
import { VoiceButton } from './VoiceButton';

type RepeatChoice = 'none' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

interface Form {
  title: string;
  type: EventType;
  allDay: boolean;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
  participants: number[];
  bring: { text: string; done: boolean }[];
  repeat: RepeatChoice;
  weekdays: number[];
  until: string;
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function blank(day: string): Form {
  const now = new Date();
  const hour = Math.min(Math.max(now.getHours() + 1, 8), 20);
  return {
    title: '', type: 'other', allDay: false, date: day, endDate: day,
    startTime: `${pad(hour)}:00`, endTime: `${pad(hour + 1)}:00`,
    location: '', notes: '', participants: [], bring: [],
    repeat: 'none', weekdays: [], until: '',
  };
}

function fromEvent(e: CalendarEvent): Form {
  const s = new Date(e.start);
  const end = new Date(e.end);
  const r = e.repeat;
  return {
    title: e.title, type: e.type, allDay: e.allDay,
    date: dateKey(s), endDate: dateKey(e.allDay ? addDays(end, -1) : end),
    startTime: timeOf(e.start), endTime: timeOf(e.end),
    location: e.location ?? '', notes: e.notes ?? '',
    participants: e.participants, bring: e.bring,
    repeat: !r ? 'none' : r.freq === 'weekly' ? (r.interval === 2 ? 'biweekly' : 'weekly') : r.freq,
    weekdays: r?.weekdays ?? [], until: r?.until ?? '',
  };
}

function toInput(f: Form): EventInput {
  let start: Date;
  let end: Date;
  if (f.allDay) {
    start = fromKey(f.date);
    end = addDays(fromKey(f.endDate < f.date ? f.date : f.endDate), 1);
  } else {
    start = new Date(`${f.date}T${f.startTime}`);
    end = new Date(`${f.date}T${f.endTime || f.startTime}`);
    if (end <= start) end = new Date(start.getTime() + 60 * 60_000);
  }
  let repeat: Repeat | null = null;
  if (f.repeat !== 'none') {
    const freq = f.repeat === 'biweekly' ? 'weekly' : f.repeat;
    repeat = { freq, interval: f.repeat === 'biweekly' ? 2 : 1, until: f.until || null };
    if (freq === 'weekly') repeat.weekdays = f.weekdays.length ? f.weekdays : [(start.getDay() + 6) % 7];
  }
  return {
    title: f.title.trim(), type: f.type, allDay: f.allDay,
    start: start.toISOString(), end: end.toISOString(),
    location: f.location.trim() || null, notes: f.notes.trim() || null,
    participants: f.participants,
    bring: f.bring.filter((b) => b.text.trim()), repeat,
  };
}

function applyDraft(f: Form, d: EventDraft, members: Member[]): Form {
  const ids = d.participants
    .map((n) => members.find((m) => m.name.toLowerCase() === n.toLowerCase())?.id)
    .filter((x): x is number => x !== undefined);
  return {
    ...f,
    title: d.title || f.title,
    type: d.type,
    allDay: d.allDay,
    date: d.date || f.date,
    endDate: d.date || f.date,
    startTime: d.startTime ?? f.startTime,
    endTime: d.endTime ?? (d.startTime ? `${pad(Math.min(Number(d.startTime.slice(0, 2)) + 1, 23))}:${d.startTime.slice(3, 5)}` : f.endTime),
    location: d.location ?? f.location,
    notes: d.notes ?? f.notes,
    participants: ids.length ? ids : f.participants,
    bring: d.bring.length ? d.bring.map((text) => ({ text, done: false })) : f.bring,
  };
}

/** Shrinks a photo to ≤1600 px JPEG so uploads stay small. */
async function photoToBase64(file: File): Promise<{ mediaType: string; data: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
}

interface Props {
  members: Member[];
  canEdit: boolean;
  aiEnabled: boolean;
  occurrence: Occurrence | null; // null = new event
  day: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EventSheet({ members, canEdit, aiEnabled, occurrence, day, onClose, onSaved }: Props) {
  const isNew = !occurrence;
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [form, setForm] = useState<Form>(() => blank(day));
  const [editing, setEditing] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magic, setMagic] = useState('');
  const [reading, setReading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [newItem, setNewItem] = useState('');

  useEffect(() => {
    if (occurrence?.eventId) {
      api.event(occurrence.eventId).then((e) => {
        setEvent(e);
        setForm(fromEvent(e));
      }).catch((e: Error) => setError(e.message));
    }
  }, [occurrence]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function read(image?: File, spoken?: string) {
    const text = (spoken ?? magic).trim();
    if (!text && !image) return;
    setReading(true);
    setError(null);
    try {
      const draft = await api.draft(text, image ? await photoToBase64(image) : undefined);
      setForm((f) => applyDraft(f, draft, members));
      setMagic('');
    } catch (e) {
      setError((e as Error).message);
      // Claude couldn't fill it in (e.g. no credit): at least keep what was said as the title.
      if (spoken) setForm((f) => (f.title.trim() ? f : { ...f, title: spoken.slice(0, 120) }));
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return setError('Give it a title');
    setBusy(true);
    setError(null);
    try {
      if (event) await api.updateEvent(event.id, toInput(form));
      else await api.createEvent(toInput(form));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove(onlyThisDate: boolean) {
    if (!event) return;
    setBusy(true);
    try {
      await api.deleteEvent(event.id, onlyThisDate ? occurrence!.start : undefined);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function tick(i: number) {
    if (!event) return;
    const { bring } = await api.toggleBring(event.id, i);
    setEvent({ ...event, bring });
    setForm((f) => ({ ...f, bring }));
  }

  // Generated items (birthdays, holidays) have nothing to edit.
  if (occurrence && !occurrence.eventId) {
    return (
      <Sheet title={occurrence.title} onClose={onClose}>
        <p className="muted">
          {occurrence.kind === 'birthday' ? 'From the Family page — change the date there.' : 'From the Portuguese holiday and school calendar.'}
        </p>
      </Sheet>
    );
  }

  if (!editing && occurrence) {
    const s = new Date(occurrence.start);
    return (
      <Sheet title={occurrence.title} onClose={onClose}>
        <div className="detail">
          <p className="detail-when">
            {s.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            {occurrence.allDay ? ' · all day' : ` · ${timeOf(occurrence.start)}–${timeOf(occurrence.end)}`}
          </p>
          <div className="detail-meta">
            <span className="meta-item"><Icon name={occurrence.type} />{TYPE_LABEL[occurrence.type]}</span>
            {occurrence.repeats && <span className="meta-item"><Icon name="repeat" />Repeats</span>}
            {occurrence.location && <span className="meta-item"><Icon name="pin" />{occurrence.location}</span>}
          </div>
          {occurrence.participants.length > 0 && <AvatarStack ids={occurrence.participants} members={members} size={32} />}
          {event?.notes && <p className="detail-notes">{event.notes}</p>}
          {(event?.bring.length ?? 0) > 0 && (
            <div className="bring">
              <h3>Bring</h3>
              {event!.bring.map((b, i) => (
                <label key={i} className={`bring-item ${b.done ? 'done' : ''}`}>
                  <input type="checkbox" checked={b.done} onChange={() => tick(i)} />
                  {b.text}
                </label>
              ))}
            </div>
          )}
          {error && <p className="error">{error}</p>}
          {canEdit ? (
            <button className="primary wide" onClick={() => setEditing(true)} disabled={!event}>Edit</button>
          ) : (
            <p className="muted">Parents can edit this after signing in.</p>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={isNew ? 'New event' : 'Edit event'} onClose={onClose}>
      <form className="event-form" onSubmit={save}>
        {aiEnabled && isNew && (
          <div className="magic">
            <Icon name="sparkle" />
            <input
              id="magic"
              value={magic}
              onChange={(e) => setMagic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void read())}
              placeholder="Dentist Guilherme Tue 3pm… or a photo"
              aria-label="Describe the event"
              disabled={reading}
            />
            <VoiceButton onText={setMagic} onDone={(t) => read(undefined, t)} onError={setError} />
            {magic.trim() ? (
              <button type="button" className="chip dark" onClick={() => read()} disabled={reading}>{reading ? 'Reading…' : 'Fill in'}</button>
            ) : (
              <button type="button" className="round" aria-label="Read from a photo" onClick={() => fileRef.current?.click()} disabled={reading}>
                {reading ? <span className="spinner" /> : <Icon name="camera" />}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
          </div>
        )}

        <div className="title-row">
          <input id="title" className="title-input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="What's happening?" aria-label="Title" maxLength={120} />
          {!(aiEnabled && isNew) && <VoiceButton onText={(t) => set('title', t.slice(0, 120))} onDone={(t) => set('title', t.slice(0, 120))} onError={setError} />}
        </div>

        <div className="types" role="group" aria-label="Type">
          {EVENT_TYPES.map((t) => (
            <button type="button" key={t} className={`type ${form.type === t ? 'on' : ''}`} onClick={() => set('type', t)} aria-pressed={form.type === t}>
              <Icon name={t} size={16} />
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        <fieldset>
          <legend>Who</legend>
          <div className="who">
            {members.map((m) => (
              <button type="button" key={m.id} className={`who-btn ${form.participants.includes(m.id) ? 'on' : ''}`} style={{ '--c': m.color } as React.CSSProperties} onClick={() => set('participants', toggle(form.participants, m.id))} aria-pressed={form.participants.includes(m.id)}>
                <Avatar member={m} size={30} />
                {m.name}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>When</legend>
          <label className="switch">
            <input type="checkbox" checked={form.allDay} onChange={(e) => set('allDay', e.target.checked)} />
            All day
          </label>
          <div className="when">
            <label>
              <span>{form.allDay ? 'From' : 'Date'}</span>
              <input id="date" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))} required />
            </label>
            {form.allDay ? (
              <label>
                <span>To</span>
                <input id="endDate" type="date" value={form.endDate} min={form.date} onChange={(e) => set('endDate', e.target.value)} />
              </label>
            ) : (
              <>
                <label>
                  <span>Starts</span>
                  <input id="startTime" type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} required />
                </label>
                <label>
                  <span>Ends</span>
                  <input id="endTime" type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />
                </label>
              </>
            )}
          </div>
          <div className="when">
            <label>
              <span>Repeats</span>
              <select id="repeat" value={form.repeat} onChange={(e) => set('repeat', e.target.value as RepeatChoice)}>
                <option value="none">Never</option>
                <option value="weekly">Every week</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Every month</option>
                <option value="yearly">Every year</option>
              </select>
            </label>
            {form.repeat !== 'none' && (
              <label>
                <span>Until</span>
                <input id="until" type="date" value={form.until} min={form.date} onChange={(e) => set('until', e.target.value)} />
              </label>
            )}
          </div>
          {(form.repeat === 'weekly' || form.repeat === 'biweekly') && (
            <div className="weekdays" role="group" aria-label="On these days">
              {WEEKDAYS.map((w, i) => {
                const on = form.weekdays.length ? form.weekdays.includes(i) : (fromKey(form.date).getDay() + 6) % 7 === i;
                return (
                  <button type="button" key={i} className={on ? 'on' : ''} aria-pressed={on} onClick={() => set('weekdays', toggle(form.weekdays.length ? form.weekdays : [(fromKey(form.date).getDay() + 6) % 7], i))}>
                    {w}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>Details</legend>
          <label className="stacked">
            <span>Where</span>
            <input id="location" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Place or address" maxLength={200} />
          </label>
          <div className="stacked">
            <span>Bring</span>
            <ul className="bring-edit">
              {form.bring.map((b, i) => (
                <li key={i}>
                  <span>{b.text}</span>
                  <button type="button" className="x" aria-label={`Remove ${b.text}`} onClick={() => set('bring', form.bring.filter((_, j) => j !== i))}>×</button>
                </li>
              ))}
            </ul>
            <div className="bring-add">
              <input
                id="bring"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newItem.trim()) {
                    e.preventDefault();
                    set('bring', [...form.bring, { text: newItem.trim(), done: false }]);
                    setNewItem('');
                  }
                }}
                placeholder="Gift, swimsuit, health card…"
                maxLength={80}
              />
              <button type="button" className="chip" disabled={!newItem.trim()} onClick={() => { set('bring', [...form.bring, { text: newItem.trim(), done: false }]); setNewItem(''); }}>Add</button>
            </div>
          </div>
          <label className="stacked">
            <span>Notes</span>
            <textarea id="notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} maxLength={2000} />
          </label>
        </fieldset>

        {error && <p className="error">{error}</p>}

        <div className="form-actions">
          {event && !confirmDelete && (
            <button type="button" className="danger-link" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={16} /> Delete
            </button>
          )}
          {confirmDelete && (
            <div className="confirm">
              {event?.repeat ? (
                <>
                  <button type="button" className="chip" onClick={() => remove(true)} disabled={busy}>Only this date</button>
                  <button type="button" className="chip danger" onClick={() => remove(false)} disabled={busy}>All dates</button>
                </>
              ) : (
                <button type="button" className="chip danger" onClick={() => remove(false)} disabled={busy}>Yes, delete</button>
              )}
              <button type="button" className="chip" onClick={() => setConfirmDelete(false)}>Keep</button>
            </div>
          )}
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Add to calendar' : 'Save'}</button>
        </div>
      </form>
    </Sheet>
  );
}

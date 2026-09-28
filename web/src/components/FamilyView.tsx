import { useEffect, useState, type FormEvent } from 'react';
import { DOCUMENT_KINDS, type DocumentKind, type Member, type MemberDocument, type Role } from '../../../shared/types';
import { api, type GoogleStatus, type TelegramStatus } from '../api';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { PhotoCropper } from './PhotoCropper';
import { Sheet } from './Sheet';

const COLORS = ['#4c7be8', '#d9548a', '#1f9a71', '#8a5cd6', '#c97714', '#0e8fa3', '#c2413b', '#5e6b2f'];

function age(birthday: string | null): string {
  if (!birthday) return '';
  const b = new Date(birthday);
  if (b.getFullYear() <= 1904) return `birthday ${b.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`; // year unknown
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a--;
  return `${a} years`;
}

export function FamilyView({ members, canEdit, googleOn, telegramOn, onChanged }: { members: Member[]; canEdit: boolean; googleOn: boolean; telegramOn: boolean; onChanged: () => void }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const viewed = members.find((m) => m.id === viewing);
  return (
    <div className="family">
      <header className="cal-head">
        <div className="cal-title">
          <span className="eyebrow">Everyone in the calendar</span>
          <h1>Family</h1>
        </div>
      </header>
      <ul className="member-list">
        {members.map((m) => (
          <li key={m.id}>
            <button className="card member" onClick={() => setViewing(m.id)}>
              <Avatar member={m} size={40} />
              <span className="member-text">
                <span className="card-title">{m.name}</span>
                <span className="muted small">
                  {m.role === 'parent' ? 'Parent' : 'Kid'}
                  {m.birthday ? ` · ${age(m.birthday)}` : ' · add a birthday'}
                  {m.role === 'parent' && googleOn ? (m.googleEmail ? ' · Google ✓' : ' · no Google address') : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {canEdit && (
        <button className="chip" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} /> Add someone
        </button>
      )}
      {!canEdit && <p className="muted">Sign in as a parent to edit the family.</p>}
      {canEdit && <GoogleCard members={members} onChanged={onChanged} />}
      {canEdit && telegramOn && <TelegramCard />}
      {viewed && !editing && <MemberView member={viewed} canEdit={canEdit} onClose={() => setViewing(null)} onEdit={() => setEditing(viewed)} />}
      {editing && (
        <MemberSheet
          member={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            setViewing(id); // back to the profile (null after removing someone)
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function MemberSheet({ member, onClose, onSaved }: { member: Member | null; onClose: () => void; onSaved: (id: number | null) => void }) {
  const [name, setName] = useState(member?.name ?? '');
  const [role, setRole] = useState<Role>(member?.role ?? 'kid');
  const [color, setColor] = useState(member?.color ?? COLORS[5]!);
  const [birthday, setBirthday] = useState(member?.birthday ?? '');
  const [googleEmail, setGoogleEmail] = useState(member?.googleEmail ?? '');
  const [photo, setPhoto] = useState<string | null>(member?.photo ?? null); // URL or a new data: URL
  const [cropping, setCropping] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [docs, setDocs] = useState<MemberDocument[] | null>(member ? null : []); // null while loading

  useEffect(() => {
    if (member) api.documents(member.id).then(setDocs).catch((e) => setError((e as Error).message));
  }, [member]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const body = { name: name.trim(), role, color, birthday: birthday || null, googleEmail: googleEmail.trim() || null };
    try {
      const saved = member ? await api.updateMember(member.id, body) : await api.addMember(body);
      if (photo?.startsWith('data:')) await api.setPhoto(saved.id, photo);
      else if (!photo && member?.photo) await api.removePhoto(saved.id);
      if (docs) await api.saveDocuments(saved.id, docs);
      onSaved(saved.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove() {
    try {
      await api.deleteMember(member!.id);
      onSaved(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (cropping) {
    return (
      <Sheet title="Picture" onClose={() => setCropping(null)}>
        <PhotoCropper
          file={cropping}
          onCancel={() => setCropping(null)}
          onDone={(p) => {
            setPhoto(p);
            setCropping(null);
          }}
        />
      </Sheet>
    );
  }

  return (
    <Sheet title={member ? member.name : 'Add someone'} onClose={onClose}>
      <form className="event-form" onSubmit={save}>
        <label className="stacked">
          <span>Name</span>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </label>
        <div className="photo-pick">
          <Avatar member={{ name: name || '?', color, photo }} size={64} />
          <label className="chip">
            <Icon name="camera" size={16} /> {photo ? 'Change picture' : 'Add picture'}
            <input type="file" accept="image/*" onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ''; // so picking the same file again still fires
                if (f) setCropping(f);
              }} />
          </label>
          {photo && (
            <button type="button" className="chip" onClick={() => setPhoto(null)}>
              Remove picture
            </button>
          )}
        </div>
        <div className="types" role="group" aria-label="Role">
          {(['parent', 'kid'] as const).map((r) => (
            <button type="button" key={r} className={`type ${role === r ? 'on' : ''}`} aria-pressed={role === r} onClick={() => setRole(r)}>
              {r === 'parent' ? 'Parent' : 'Kid'}
            </button>
          ))}
        </div>
        <div className="stacked">
          <span>Colour</span>
          <div className="swatches">
            {COLORS.map((c) => (
              <button type="button" key={c} className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <label className="stacked">
          <span>Birthday (use the year 1904 to hide the age)</span>
          <input id="birthday" type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
        </label>
        {role === 'parent' && (
          <label className="stacked">
            <span>Google account (for the shared Google calendar)</span>
            <input id="googleEmail" type="email" value={googleEmail} onChange={(e) => setGoogleEmail(e.target.value)} placeholder="name@gmail.com" />
          </label>
        )}
        {docs && <DocumentsEditor docs={docs} onChange={setDocs} />}
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          {member && !confirm && (
            <button type="button" className="danger-link" onClick={() => setConfirm(true)}>
              <Icon name="trash" size={16} /> Remove
            </button>
          )}
          {confirm && (
            <div className="confirm">
              <button type="button" className="chip danger" onClick={remove}>Remove {member!.name}</button>
              <button type="button" className="chip" onClick={() => setConfirm(false)}>Keep</button>
            </div>
          )}
          <button type="submit" className="primary" disabled={!docs}>Save</button>
        </div>
      </form>
    </Sheet>
  );
}

const longDate = (d: string) => new Date(`${d}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const docName = (d: MemberDocument) => (d.kind === 'other' && d.label) || DOCUMENT_KINDS[d.kind].label;

function expiry(expires: string) {
  const days = Math.round((new Date(`${expires}T12:00`).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: `Expired ${longDate(expires)}`, level: 'bad' };
  if (days <= 90) return { text: `Expires ${longDate(expires)} · in ${days} day${days === 1 ? '' : 's'}`, level: 'soon' };
  return { text: `Valid until ${longDate(expires)}`, level: '' };
}

/** What you see when you tap someone: their details and, for parents, their documents. */
function MemberView({ member, canEdit, onClose, onEdit }: { member: Member; canEdit: boolean; onClose: () => void; onEdit: () => void }) {
  const [docs, setDocs] = useState<MemberDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    if (canEdit) api.documents(member.id).then(setDocs).catch((e) => setError((e as Error).message));
  }, [member.id, canEdit]);

  async function copy(i: number, text: string) {
    await navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(i);
    setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
  }

  const edit = canEdit ? (
    <button className="round ghost" aria-label={`Edit ${member.name}`} onClick={onEdit}>
      <Icon name="edit" />
    </button>
  ) : null;

  return (
    <Sheet title={member.name} onClose={onClose} actions={edit}>
      <div className="profile">
        <Avatar member={member} size={72} />
        <div className="member-text">
          <span className="muted">{member.role === 'parent' ? 'Parent' : 'Kid'}{member.birthday ? ` · ${age(member.birthday)}` : ''}</span>
          {member.birthday && new Date(member.birthday).getFullYear() > 1904 && <span className="muted small">Born {longDate(member.birthday)}</span>}
        </div>
      </div>
      {!canEdit && <p className="muted small">Sign in as a parent to see documents.</p>}
      {error && <p className="error">{error}</p>}
      {canEdit && docs && docs.length === 0 && (
        <p className="muted small">No documents yet. Tap the pencil to add NIF, Cartão de Cidadão, nº de utente…</p>
      )}
      {docs && docs.length > 0 && (
        <ul className="docs">
          {docs.map((d, i) => {
            const exp = d.expires ? expiry(d.expires) : null;
            return (
              <li key={i} className="card doc">
                <span className="muted small">{docName(d)}</span>
                <div className="doc-main">
                  {d.number && <span className="doc-number">{d.number}</span>}
                  <span className="doc-buttons">
                    {d.number && (
                      <button className="chip" onClick={() => copy(i, d.number)} aria-label={`Copy ${docName(d)}`}>
                        <Icon name={copied === i ? 'check' : 'copy'} size={16} /> {copied === i ? 'Copied' : 'Copy'}
                      </button>
                    )}
                    {d.link && (
                      <a className="chip" href={d.link} target="_blank" rel="noreferrer">
                        <Icon name="open" size={16} /> Open
                      </a>
                    )}
                  </span>
                </div>
                {exp && <span className={`small doc-exp ${exp.level}`}>{exp.text}</span>}
                {d.note && <span className="muted small">{d.note}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

function DocumentsEditor({ docs, onChange }: { docs: MemberDocument[]; onChange: (docs: MemberDocument[]) => void }) {
  const set = (i: number, patch: Partial<MemberDocument>) => onChange(docs.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const used = new Set(docs.map((d) => d.kind));
  const free = (Object.keys(DOCUMENT_KINDS) as DocumentKind[]).filter((k) => k === 'other' || !used.has(k));
  return (
    <div className="stacked docs-edit">
      <span>Documents (only parents can see these)</span>
      {docs.map((d, i) => (
        <div key={i} className="doc-edit">
          <div className="doc-edit-head">
            <b>{DOCUMENT_KINDS[d.kind].label}</b>
            <button type="button" className="round ghost" aria-label={`Remove ${docName(d)}`} onClick={() => onChange(docs.filter((_, j) => j !== i))}>
              <Icon name="trash" size={16} />
            </button>
          </div>
          {d.kind === 'other' && (
            <input value={d.label ?? ''} onChange={(e) => set(i, { label: e.target.value })} placeholder="What is it? (e.g. Cartão de estudante)" maxLength={40} />
          )}
          <input value={d.number} onChange={(e) => set(i, { number: e.target.value })} placeholder="Number" maxLength={60} autoComplete="off" />
          {DOCUMENT_KINDS[d.kind].expires && (
            <label className="stacked">
              <span className="small">Valid until</span>
              <input type="date" value={d.expires ?? ''} onChange={(e) => set(i, { expires: e.target.value || null })} />
            </label>
          )}
          <input type="url" value={d.link ?? ''} onChange={(e) => set(i, { link: e.target.value || null })} placeholder="Link to the scan (Paperless)" maxLength={500} />
          <input value={d.note ?? ''} onChange={(e) => set(i, { note: e.target.value || null })} placeholder="Note (optional)" maxLength={200} />
        </div>
      ))}
      <select
        className="doc-add"
        value=""
        onChange={(e) => e.target.value && onChange([...docs, { kind: e.target.value as DocumentKind, label: null, number: '', expires: null, link: null, note: null }])}
      >
        <option value="">+ Add a document…</option>
        {free.map((k) => (
          <option key={k} value={k}>{DOCUMENT_KINDS[k].label}</option>
        ))}
      </select>
    </div>
  );
}

function GoogleCard({ members, onChanged }: { members: Member[]; onChanged: () => void }) {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.googleStatus().then(setStatus).catch(() => {});
  }, [members]);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.connectGoogle(key.trim()));
      setKey('');
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  const parentsWithout = members.filter((m) => m.role === 'parent' && !m.googleEmail);
  return (
    <section className="card google">
      <h2>Google Calendar</h2>
      {status.connected ? (
        <>
          <p className="muted small">
            Connected. Everything here is copied to a shared <b>Family</b> calendar, and events added there show up here.
          </p>
          {status.sharedWith.length > 0 && <p className="small">Shared with {status.sharedWith.join(', ')}: accept the invite email, then set notifications for "Family" in Google Calendar.</p>}
          {parentsWithout.length > 0 && <p className="small muted">Add a Google address for {parentsWithout.map((p) => p.name).join(' and ')} to share it with them too.</p>}
          {status.lastError && <p className="error small">Last sync failed: {status.lastError}</p>}
          {status.lastSync && <p className="muted small">Last sync {new Date(status.lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>}
        </>
      ) : (
        <form className="event-form" onSubmit={connect}>
          <p className="muted small">Paste the service account key (the JSON file from Google Cloud) to connect. It stays on the home server.</p>
          <textarea id="googleKey" className="key-input" value={key} onChange={(e) => setKey(e.target.value)} rows={4} placeholder='{ "type": "service_account", … }' spellCheck={false} autoComplete="off" />
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary" disabled={busy || !key.trim()}>{busy ? 'Connecting…' : 'Connect'}</button>
        </form>
      )}
    </section>
  );
}

function TelegramCard() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = () => api.telegram().then(setStatus).catch((e) => setNote((e as Error).message));
  useEffect(() => void load(), []);

  async function run(action: () => Promise<TelegramStatus>, done?: (s: TelegramStatus) => string | null) {
    setBusy(true);
    setNote(null);
    try {
      const s = await action();
      setStatus(s);
      setNote(done?.(s) ?? null);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return note ? <section className="card google"><h2>Telegram</h2><p className="error small">{note}</p></section> : null;
  const link = status.bot ? `https://t.me/${status.bot}` : null;
  return (
    <section className="card google">
      <h2>Telegram</h2>
      <p className="muted small">Reminders and the morning, evening and Sunday messages go to:</p>
      {status.recipients.length === 0 && <p className="small"><b>Nobody yet</b> — add yourself below.</p>}
      <ul className="tg-list">
        {status.recipients.map((r) => (
          <li key={r.id}>
            <span>{r.name}</span>
            {!r.fixed && (
              <button className="chip" disabled={busy} onClick={() => run(() => api.removeTelegram(r.id))}>Remove</button>
            )}
          </li>
        ))}
      </ul>
      {status.waiting.length > 0 && (
        <>
          <p className="muted small">Opened the bot, not getting messages yet:</p>
          <ul className="tg-list">
            {status.waiting.map((w) => (
              <li key={w.id}>
                <span>{w.name}</span>
                <button className="chip" disabled={busy} onClick={() => run(() => api.addTelegram(w.id, w.name), (s) => (s.sent ? `Added — ${w.name} got a hello message.` : `Added, but the hello message didn't go through.`))}>Add</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="small">
        To add someone: send them {link ? <a href={link} target="_blank" rel="noreferrer">{link.replace('https://', '')}</a> : 'the bot'}, they tap <b>Start</b>, then{' '}
        <button className="link" disabled={busy} onClick={() => void load()}>refresh</button> and tap Add. (Only shows people who wrote to the bot in the last day.)
      </p>
      {note && <p className="small">{note}</p>}
    </section>
  );
}

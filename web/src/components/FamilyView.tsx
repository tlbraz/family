import { useState, type FormEvent } from 'react';
import type { Member, Role } from '../../../shared/types';
import { api } from '../api';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

const COLORS = ['#4c7be8', '#d9548a', '#1f9a71', '#8a5cd6', '#c97714', '#0e8fa3', '#c2413b', '#5e6b2f'];

function age(birthday: string | null): string {
  if (!birthday) return '';
  const b = new Date(birthday);
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a--;
  return `${a} years`;
}

export function FamilyView({ members, canEdit, googleOn, onChanged }: { members: Member[]; canEdit: boolean; googleOn: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
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
            <button className="card member" onClick={() => canEdit && setEditing(m)} disabled={!canEdit}>
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
      {editing && (
        <MemberSheet
          member={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function MemberSheet({ member, onClose, onSaved }: { member: Member | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(member?.name ?? '');
  const [role, setRole] = useState<Role>(member?.role ?? 'kid');
  const [color, setColor] = useState(member?.color ?? COLORS[5]!);
  const [birthday, setBirthday] = useState(member?.birthday ?? '');
  const [googleEmail, setGoogleEmail] = useState(member?.googleEmail ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const body = { name: name.trim(), role, color, birthday: birthday || null, googleEmail: googleEmail.trim() || null };
    try {
      if (member) await api.updateMember(member.id, body);
      else await api.addMember(body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove() {
    try {
      await api.deleteMember(member!.id);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Sheet title={member ? member.name : 'Add someone'} onClose={onClose}>
      <form className="event-form" onSubmit={save}>
        <label className="stacked">
          <span>Name</span>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </label>
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
          <span>Birthday</span>
          <input id="birthday" type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
        </label>
        {role === 'parent' && (
          <label className="stacked">
            <span>Google account (for the shared Google calendar)</span>
            <input id="googleEmail" type="email" value={googleEmail} onChange={(e) => setGoogleEmail(e.target.value)} placeholder="name@gmail.com" />
          </label>
        )}
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
          <button type="submit" className="primary">Save</button>
        </div>
      </form>
    </Sheet>
  );
}

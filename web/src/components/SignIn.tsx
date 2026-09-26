import { useState, type FormEvent } from 'react';
import type { Member } from '../../../shared/types';
import { api } from '../api';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';

export function SignIn({ members, onClose, onDone }: { members: Member[]; onClose: () => void; onDone: () => void }) {
  const parents = members.filter((m) => m.role === 'parent');
  const [who, setWho] = useState<Member | null>(parents.length === 1 ? parents[0]! : null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!who) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(who.id, password);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title="Sign in" onClose={onClose}>
      <form className="signin" onSubmit={submit}>
        <p className="muted">Everyone can see the calendar. Parents sign in to add and change things; this phone stays signed in.</p>
        <div className="who">
          {parents.map((p) => (
            <button type="button" key={p.id} className={`who-btn ${who?.id === p.id ? 'on' : ''}`} style={{ '--c': p.color } as React.CSSProperties} onClick={() => setWho(p)} aria-pressed={who?.id === p.id}>
              <Avatar member={p} size={30} />
              {p.name}
            </button>
          ))}
        </div>
        {who && (
          <label className="stacked">
            <span>{who.hasPassword ? 'Password' : 'Choose a password (first sign-in)'}</span>
            <input id="password" type="password" autoComplete={who.hasPassword ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus minLength={who.hasPassword ? undefined : 6} required />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary wide" disabled={!who || busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </Sheet>
  );
}

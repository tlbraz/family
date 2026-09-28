import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isHigh, validBp, type BpLog, type BpReading } from '../../../shared/bp';
import type { Member } from '../../../shared/types';
import { api, type TelegramStatus } from '../api';
import { addDays, dateKey, pad, timeOf } from '../dates';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import './BloodPressure.css';

const localInput = (d: Date) => `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const when = (iso: string) => {
  const d = new Date(iso);
  const today = dateKey(new Date());
  const day = dateKey(d) === today ? 'Today' : dateKey(d) === dateKey(addDays(new Date(), -1)) ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} · ${timeOf(iso)}`;
};

/**
 * Logging a reading in as few taps as possible: type the digits straight through (12882 → 128/82),
 * tap any tags, Save. "Add another" keeps the tags for the second reading a minute later.
 */
export function BpEntrySheet({ member, onClose, onSaved }: { member: Pick<Member, 'id' | 'name'>; onClose: () => void; onSaved?: () => void }) {
  const [tags, setTags] = useState<string[]>([]);
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [at, setAt] = useState<string | null>(null); // null = now
  const [newTag, setNewTag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<BpReading | null>(null);
  const sysRef = useRef<HTMLInputElement>(null);
  const diaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.bp(member.id).then((log) => setTags(log.tags)).catch((e: Error) => setError(e.message));
  }, [member.id]);

  // Systolic is 3 digits when it starts with 1 or 2 (almost always); jump to diastolic when it's complete.
  function typeSys(v: string) {
    const digits = v.replace(/\D/g, '').slice(0, 3);
    setSys(digits);
    if (digits.length === 3 || (digits.length === 2 && !/^[12]/.test(digits))) diaRef.current?.focus();
  }

  const s = Number(sys);
  const d = Number(dia);
  const ok = sys.length >= 2 && dia.length >= 2 && validBp(s, d);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!ok) return setError(sys && dia ? 'Those numbers don’t look right (top number first, e.g. 128 / 82)' : 'Type both numbers');
    setBusy(true);
    setError(null);
    try {
      const r = await api.addBp(member.id, { at: new Date(at ?? Date.now()).toISOString(), systolic: s, diastolic: d, tags: picked, note: note.trim() || null });
      setSaved(r);
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function another() {
    setSaved(null);
    setSys('');
    setDia('');
    setAt(null);
    setTimeout(() => sysRef.current?.focus(), 50);
  }

  const toggle = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  function addTag() {
    const t = (newTag ?? '').trim().slice(0, 30);
    if (t) {
      if (!tags.includes(t)) setTags([...tags, t]);
      if (!picked.includes(t)) setPicked([...picked, t]);
    }
    setNewTag(null);
  }

  if (saved) {
    return (
      <Sheet title="Blood pressure" onClose={onClose}>
        <div className="bp-saved">
          <span className="bp-saved-check"><Icon name="check" size={28} stroke={3} /></span>
          <span className="bp-saved-value">{saved.systolic}/{saved.diastolic}</span>
          <span className="muted">{when(saved.at)}{saved.tags.length ? ` · ${saved.tags.join(', ')}` : ''}</span>
        </div>
        <div className="form-actions">
          <button type="button" className="chip" onClick={another}>Add another</button>
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Blood pressure" onClose={onClose}>
      <form className="event-form" onSubmit={save}>
        <div className="bp-numbers">
          <label>
            <input ref={sysRef} value={sys} onChange={(e) => typeSys(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="128" aria-label="Systolic (top number)" autoFocus />
            <span>Systolic</span>
          </label>
          <span className="bp-slash">/</span>
          <label>
            <input ref={diaRef} value={dia} onChange={(e) => setDia(e.target.value.replace(/\D/g, '').slice(0, 3))}
              onKeyDown={(e) => e.key === 'Backspace' && !dia && sysRef.current?.focus()}
              inputMode="numeric" autoComplete="off" placeholder="82" aria-label="Diastolic (bottom number)" />
            <span>Diastolic</span>
          </label>
          <span className="bp-unit">mmHg</span>
        </div>

        <div className="bp-tags" role="group" aria-label="Tags">
          {tags.map((t) => (
            <button type="button" key={t} className={`bp-tag ${picked.includes(t) ? 'on' : ''}`} aria-pressed={picked.includes(t)} onClick={() => toggle(t)}>
              {picked.includes(t) && <Icon name="check" size={14} stroke={3} />}
              {t}
            </button>
          ))}
          {newTag === null ? (
            <button type="button" className="bp-tag add" onClick={() => setNewTag('')}><Icon name="plus" size={14} /> Tag</button>
          ) : (
            <input className="bp-tag-input" value={newTag} autoFocus maxLength={30} placeholder="New tag" aria-label="New tag"
              onChange={(e) => setNewTag(e.target.value)} onBlur={addTag}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } if (e.key === 'Escape') setNewTag(null); }} />
          )}
        </div>

        <div className="when">
          <label>
            <span>When</span>
            <input type="datetime-local" value={at ?? localInput(new Date())} max={localInput(new Date())} onChange={(e) => setAt(e.target.value || null)} />
          </label>
          <label className="stacked">
            <span>Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Optional" />
          </label>
        </div>

        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="primary wide" disabled={busy || !ok}>{busy ? 'Saving…' : ok ? `Save ${s}/${d}` : 'Save'}</button>
        </div>
      </form>
    </Sheet>
  );
}

/** The blood pressure part of an adult's profile (parents only see it). */
export function BpSection({ member, telegramOn }: { member: Member; telegramOn: boolean }) {
  const [log, setLog] = useState<BpLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [days, setDays] = useState(30);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = () => api.bp(member.id).then(setLog).catch((e: Error) => setError(e.message));
  useEffect(() => void load(), [member.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (log?.tracking && telegramOn) api.telegram().then(setTelegram).catch(() => {});
  }, [log?.tracking, telegramOn]);

  const settings = (tracking: boolean, telegramId: string | null) =>
    api.bpSettings(member.id, { tracking, telegramId }).then(setLog).catch((e: Error) => setError(e.message));

  if (!log) return error ? <p className="error">{error}</p> : null;
  if (!log.tracking) {
    return (
      <div className="card bp-off">
        <span className="bp-title"><Icon name="heart" size={18} /> Blood pressure</span>
        <span className="muted small">Keep a log of home readings, with tags like “forgot meds”, and make a report for the doctor.</span>
        <button className="chip" onClick={() => settings(true, null)}>Start a log</button>
      </div>
    );
  }

  const week = log.readings.filter((r) => Date.now() - new Date(r.at).getTime() < 7 * 86_400_000);
  const avg = week.length ? { s: Math.round(week.reduce((a, r) => a + r.systolic, 0) / week.length), d: Math.round(week.reduce((a, r) => a + r.diastolic, 0) / week.length) } : null;
  const to = dateKey(new Date());
  const from = dateKey(addDays(new Date(), -(days - 1)));
  const chats = telegram ? [...telegram.recipients, ...telegram.waiting] : [];

  async function remove(r: BpReading) {
    if (!confirm(`Delete ${r.systolic}/${r.diastolic} from ${when(r.at)}?`)) return;
    await api.deleteBp(member.id, r.id).catch((e: Error) => setError(e.message));
    void load();
  }

  return (
    <section className="bp">
      <div className="bp-head">
        <span className="bp-title"><Icon name="heart" size={18} /> Blood pressure</span>
        <button className="chip dark" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Reading</button>
      </div>
      {avg && (
        <p className="bp-avg">
          <b className={isHigh({ systolic: avg.s, diastolic: avg.d }) ? 'bp-high' : ''}>{avg.s}/{avg.d}</b>
          <span className="muted small"> average of {week.length} reading{week.length === 1 ? '' : 's'} in the last 7 days</span>
        </p>
      )}
      {log.readings.length === 0 && <p className="muted small">No readings yet.</p>}
      <ul className="bp-list">
        {log.readings.slice(0, showAll ? 60 : 6).map((r) => (
          <li key={r.id}>
            <span className={`bp-value ${isHigh(r) ? 'bp-high' : ''}`}>{r.systolic}/{r.diastolic}{isHigh(r) && <span className="bp-up" title="At or above 135/85">▲</span>}</span>
            <span className="bp-meta">
              <span className="muted small">{when(r.at)}</span>
              {(r.tags.length > 0 || r.note) && <span className="small">{[...r.tags, ...(r.note ? [`“${r.note}”`] : [])].join(' · ')}</span>}
            </span>
            <button className="x" aria-label={`Delete ${r.systolic}/${r.diastolic}`} onClick={() => remove(r)}>×</button>
          </li>
        ))}
      </ul>
      {log.readings.length > 6 && !showAll && <button className="chip bp-more" onClick={() => setShowAll(true)}>Show more</button>}

      <div className="bp-report">
        <span className="small muted">Report for the doctor</span>
        <div className="bp-report-row">
          <div className="segmented" role="group" aria-label="Period">
            {[7, 30, 90].map((n) => (
              <button key={n} className={days === n ? 'on' : ''} aria-pressed={days === n} onClick={() => setDays(n)}>{n} days</button>
            ))}
          </div>
          <a className="chip dark" href={api.bpReportUrl(member.id, from, to)} target="_blank" rel="noreferrer"><Icon name="open" size={16} /> Open report</a>
        </div>
      </div>

      {telegramOn && (
        <label className="stacked bp-telegram">
          <span>Log from Telegram</span>
          <select value={log.telegramId ?? ''} onChange={(e) => settings(true, e.target.value || null)}>
            <option value="">Off</option>
            {chats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="muted small">
            {log.telegramId
              ? <>Send the bot{telegram?.bot ? <> (@{telegram.bot})</> : null} a private message like <b>128/82 after training</b>. Send <i>undo</i> to take it back.</>
              : <>Pick your own chat with the bot. Not listed? Open the bot in Telegram and tap Start first.</>}
          </span>
        </label>
      )}

      {error && <p className="error">{error}</p>}
      <button className="danger-link small bp-stop" onClick={() => confirm('Stop the blood pressure log? Readings are kept and come back if you start it again.') && settings(false, null)}>
        Stop the log
      </button>

      {adding && <BpEntrySheet member={member} onClose={() => { setAdding(false); void load(); }} />}
    </section>
  );
}

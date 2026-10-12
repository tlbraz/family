import { useState } from 'react';
import { payeeKey } from '../../../shared/bills';
import type { Bill, MoneySummary, MoneyTransaction } from '../../../shared/types';
import { api } from '../api';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import './Bills.css';

const eur = (cents: number) => {
  const [int, dec] = (Math.abs(cents) / 100).toFixed(2).split('.');
  return `€${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${dec}`;
};
const whole = (cents: number) => `€${Math.round(Math.abs(cents) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
const shortDate = (d: string) => new Date(`${d}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const usual = (b: Bill) => (b.cadence === 'monthly' ? `usually the ${ordinal(Number(b.date.slice(8, 10)))}` : `yearly, ${shortDate(b.date)}`);

/** One line per thing worth knowing: a price that moved, or a charge that didn't come. */
function flags(bills: Bill[]) {
  return bills.flatMap((b) => [
    ...(b.change ? [{ key: `${b.key}-c`, kind: b.change.to > b.change.from ? 'rise' : 'fall', text: <><b>{b.name}</b> {eur(b.change.from)} → {eur(b.change.to)}</> }] : []),
    ...(b.status === 'missing' ? [{ key: `${b.key}-m`, kind: 'missing', text: <><b>{b.name}</b> hasn’t come in ({b.cadence === 'monthly' ? usual(b) : `due ${shortDate(b.date)}`})</> }] : []),
  ]);
}

export function BillsCard({ data, onOpen }: { data: MoneySummary; onOpen: () => void }) {
  const b = data.bills;
  if (!b) return null;
  const total = b.bills.length;
  if (!total) {
    return (
      <button className="card money-card bills-card" onClick={onOpen}>
        <span className="bills-head"><span className="eyebrow">Bills</span><Icon name="right" /></span>
        <span className="muted small">No repeating payments spotted yet. Tap to mark one.</span>
      </button>
    );
  }
  const current = data.today !== null;
  const paidSum = b.bills.filter((x) => x.status === 'paid').reduce((s, x) => s + x.amount, 0);
  const list = flags(b.bills);
  return (
    <button className="card money-card bills-card" onClick={onOpen} aria-label={`Bills: ${b.paid} of ${total} paid${data.fixed ? `. ${splitText(data)}` : ''}`}>
      <span className="bills-head">
        <span className="eyebrow">Bills</span>
        <span className="pill">{b.paid} of {total} paid</span>
      </span>
      <span className="bills-main">
        {current && b.remaining > 0 ? (
          <><b className="bills-num">{eur(b.remaining)}</b> <span className="muted">still to come this month</span></>
        ) : (
          <><b className="bills-num">{eur(paidSum)}</b> <span className="muted">paid in bills{current ? ', nothing else due' : ''}</span></>
        )}
      </span>
      <span className="bills-bar" role="img" aria-label={`${b.paid} of ${total} bills paid`}>
        {[...b.bills].sort((x, y) => BAR[x.status] - BAR[y.status]).map((x) => <i key={x.key} className={x.status} />)}
      </span>
      {data.fixed && <FixedVsVariable data={data} />}
      {list.length > 0 && (
        <span className="bills-flags">
          {list.slice(0, 3).map((f) => (
            <span key={f.key} className={`bills-flag ${f.kind}`}>
              <span className="bills-flag-icon" aria-hidden>{f.kind === 'missing' ? '?' : f.kind === 'rise' ? '▲' : '▼'}</span>
              <span>{f.text}</span>
            </span>
          ))}
          {list.length > 3 && <span className="muted small">and {list.length - 3} more</span>}
        </span>
      )}
    </button>
  );
}

/** Fixed (the month's bills) against variable (the rest of the spending): one bar, and both named with their share. */
function FixedVsVariable({ data }: { data: MoneySummary }) {
  const f = data.fixed!;
  const fixed = f.paid + f.toCome;
  const total = fixed + f.variable || 1;
  const pct = Math.round((fixed / total) * 100);
  return (
    <span className="fixvar" aria-hidden>
      <span className="fixvar-bar">
        {f.paid > 0 && <i className="fixed" style={{ flexGrow: f.paid }} />}
        {f.toCome > 0 && <i className="tocome" style={{ flexGrow: f.toCome }} />}
        {f.variable > 0 && <i className="variable" style={{ flexGrow: f.variable }} />}
      </span>
      <span className="fixvar-row">
        <span className="fixvar-key fixed" />
        <span><b>Fixed {pct}%</b> <span className="muted">· {whole(f.paid)} paid{f.toCome > 0 ? ` · ${whole(f.toCome)} ${data.today !== null ? 'to come' : 'not seen'}` : ''}</span></span>
      </span>
      <span className="fixvar-row">
        <span className="fixvar-key variable" />
        <span><b>Variable {100 - pct}%</b> <span className="muted">· {whole(f.variable)}</span></span>
      </span>
    </span>
  );
}

const splitText = (data: MoneySummary) => {
  const f = data.fixed!;
  const fixed = f.paid + f.toCome;
  const pct = Math.round((fixed / (fixed + f.variable || 1)) * 100);
  return `Fixed ${pct}%: ${whole(f.paid)} paid${f.toCome > 0 ? `, ${whole(f.toCome)} ${data.today !== null ? 'to come' : 'not seen'}` : ''}. Variable ${100 - pct}%: ${whole(f.variable)}.`;
};

const BAR = { paid: 0, missing: 1, due: 2 } as const; // the bar fills from the left as bills get paid

const SECTIONS = [
  { status: 'due', title: 'Still to come' },
  { status: 'missing', title: 'Didn’t show up' },
  { status: 'paid', title: 'Paid' },
] as const;

export function BillsSheet({ data, onChanged, onClose }: { data: MoneySummary; onChanged: () => void; onClose: () => void }) {
  const b = data.bills!;
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // the key of the bill or candidate whose form is open

  async function act(action: 'ignore' | 'unignore' | 'track' | 'untrack', key: string, name: string) {
    setBusy(key);
    setError(null);
    try {
      await api.billAction(action, key, name);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const monthLabel = new Date(`${data.month}-15T12:00`).toLocaleDateString('en-GB', { month: 'long' });
  return (
    <Sheet title={`Bills · ${monthLabel}`} onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {b.bills.length === 0 && <p className="muted">Nothing repeats every month yet (it needs 3 of the last 4 months). You can mark a payee below.</p>}
      {SECTIONS.map(({ status, title }) => {
        const list = b.bills.filter((x) => x.status === status);
        if (!list.length) return null;
        return (
          <section key={status} className="bills-section">
            <h3>{title}{status === 'due' && b.remaining > 0 ? ` · ${eur(b.remaining)}` : ''}</h3>
            <ul className="bills-list">
              {list.map((x) => (
                <li key={x.key} className={`bill ${x.status}`}>
                  <button className="bill-row" onClick={() => setOpen(open === x.key ? null : x.key)} aria-expanded={open === x.key}>
                    <span className={`bill-dot ${x.status}`} aria-hidden>{x.status === 'paid' ? <Icon name="check" size={13} stroke={3} /> : x.status === 'missing' ? '?' : null}</span>
                    <span className="bill-text">
                      <b>{x.name}</b>
                      <span className="muted small">
                        {x.status === 'paid' ? `paid ${shortDate(x.date)}` : x.status === 'due' ? `due ${shortDate(x.date)}` : `expected ${shortDate(x.date)}`}
                        {' · '}{x.cadence === 'monthly' ? (x.varying ? 'monthly, varies' : 'monthly') : 'yearly'}
                        {x.tracked ? ' · marked by you' : ''}
                        {x.expected !== null ? ` · expected ~${eur(x.expected)}` : ''}
                      </span>
                      {x.change && <span className={`bill-change ${x.change.to > x.change.from ? 'rise' : 'fall'}`}>{x.change.to > x.change.from ? '▲' : '▼'} was {eur(x.change.from)}</span>}
                    </span>
                    <span className="bill-amount">{x.status !== 'paid' && x.varying ? '~' : ''}{eur(x.amount)}</span>
                  </button>
                  {editing === x.key && (
                    <FixedForm
                      initial={{ key: x.key, ...(x.tracked ? {} : { name: x.name }), label: x.name, expected: x.expected ?? x.amount, cadence: x.cadence, day: x.day }}
                      onCancel={() => setEditing(null)}
                      onSaved={() => { setEditing(null); onChanged(); }}
                    />
                  )}
                  {open === x.key && editing !== x.key && (
                    <div className="bill-more">
                      <span className="muted small">Last charges</span>
                      <ul className="bill-history">
                        {x.history.map((h) => <li key={h.date}><span>{shortDate(h.date)} {h.date.slice(0, 4) !== data.month.slice(0, 4) ? h.date.slice(0, 4) : ''}</span><span>{eur(h.amount)}</span></li>)}
                      </ul>
                      <span className="bill-actions">
                        <button className="chip" onClick={() => setEditing(x.key)}>Edit</button>
                        {x.tracked ? (
                          <button className="chip" disabled={busy === x.key} onClick={() => act('untrack', x.key, x.name)}>Stop tracking</button>
                        ) : (
                          <button className="chip" disabled={busy === x.key} onClick={() => act('ignore', x.key, x.name)}>Not a bill</button>
                        )}
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="bills-section">
        {!adding ? (
          <button className="chip" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> A bill is missing</button>
        ) : (
          <>
            <h3>Track as a bill</h3>
            <p className="muted small">Payees you paid more than once in the last year. Pick the one that’s a bill.</p>
            <ul className="bills-list">
              {b.candidates.map((c) => (
                <li key={c.key} className="bill">
                  <div className="bill-row">
                    <span className="bill-text">
                      <b>{c.name}</b>
                      <span className="muted small">{c.count} payments · last {eur(c.last.amount)} on {shortDate(c.last.date)}</span>
                    </span>
                    {editing !== c.key && <button className="chip" onClick={() => setEditing(c.key)}>Track</button>}
                  </div>
                  {editing === c.key && (
                    <FixedForm
                      initial={{ key: c.key, name: c.name, label: c.name, expected: c.last.amount, cadence: 'monthly', day: Number(c.last.date.slice(8, 10)) }}
                      onCancel={() => setEditing(null)}
                      onSaved={() => { setEditing(null); onChanged(); }}
                    />
                  )}
                </li>
              ))}
              {b.candidates.length === 0 && <li className="muted small">Nothing else repeats.</li>}
            </ul>
          </>
        )}
      </section>

      {b.ignored.length > 0 && (
        <section className="bills-section">
          <h3>Not bills</h3>
          <ul className="bills-list">
            {b.ignored.map((x) => (
              <li key={x.key} className="bill">
                <div className="bill-row">
                  <span className="bill-text"><b>{x.name}</b></span>
                  <button className="chip" disabled={busy === x.key} onClick={() => act('unignore', x.key, x.name)}>Show again</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Sheet>
  );
}

// ---- A fixed expense, set by hand -------------------------------------------------------------

export interface FixedInitial {
  key?: string; // a bill or candidate; from a transaction the payee is sent instead
  payee?: string;
  name?: string; // the payee as written, to remember
  label: string;
  expected: number; // cents
  cadence: 'monthly' | 'yearly';
  day: number;
}

/** What the form starts with for a transaction: what was set before, or the bill it belongs to, or the transaction itself. */
export function fixedFor(t: MoneyTransaction, data: MoneySummary): { initial: FixedInitial; existing: boolean } | null {
  const key = payeeKey(t.payee);
  if (!data.bills || !key) return null;
  const set = data.bills.tracked.find((x) => x.key === key);
  const bill = data.bills.bills.find((x) => x.key === key);
  return {
    existing: !!(set || bill),
    initial: {
      payee: t.payee,
      label: set?.label ?? bill?.name ?? t.payee,
      expected: set?.expected ?? bill?.expected ?? bill?.amount ?? t.amount,
      cadence: set?.cadence ?? bill?.cadence ?? 'monthly',
      day: set?.day ?? bill?.day ?? Number(t.date.slice(8, 10)),
    },
  };
}

/** "45", "45.9", "45,90" → cents; null when it isn't an amount. */
const toCents = (s: string) => {
  const m = s.trim().replace(/\s|€/g, '').replace(',', '.').match(/^\d+(\.\d{1,2})?$/);
  return m ? Math.round(Number(m[0]) * 100) : null;
};

/** Name, about how much, every month or year, around which day. Any amount near that day then counts as paid. */
export function FixedForm({ initial, onCancel, onSaved }: { initial: FixedInitial; onCancel: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(initial.label);
  const [amount, setAmount] = useState((initial.expected / 100).toFixed(2));
  const [cadence, setCadence] = useState(initial.cadence);
  const [day, setDay] = useState(String(initial.day));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expected = toCents(amount);
  const dayN = Number(day);
  const valid = !!label.trim() && !!expected && Number.isInteger(dayN) && dayN >= 1 && dayN <= 31;

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveFixedBill({ key: initial.key, payee: initial.payee, name: initial.name, label: label.trim(), expected: expected!, cadence, day: dayN });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="review-fix bill-form">
      <label className="stacked">
        <span>Name</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} autoComplete="off" />
      </label>
      <div className="when">
        <label>
          <span>Expected amount (€)</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoComplete="off" aria-invalid={!expected} />
        </label>
        <label>
          <span>Around day</span>
          <input value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" autoComplete="off" aria-invalid={!(dayN >= 1 && dayN <= 31)} />
        </label>
      </div>
      <div className="bill-form-every">
        <span className="muted small">Every</span>
        <div className="segmented" role="group" aria-label="Every">
          <button type="button" className={cadence === 'monthly' ? 'on' : ''} aria-pressed={cadence === 'monthly'} onClick={() => setCadence('monthly')}>Month</button>
          <button type="button" className={cadence === 'yearly' ? 'on' : ''} aria-pressed={cadence === 'yearly'} onClick={() => setCadence('yearly')}>Year</button>
        </div>
      </div>
      <p className="muted small">Any amount around that day counts as paid. You’ll hear about it if it’s more than 25% off.</p>
      {error && <p className="error small">{error}</p>}
      <div className="review-actions">
        <button className="chip" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="primary" onClick={save} disabled={busy || !valid}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

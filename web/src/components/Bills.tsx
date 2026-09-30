import { useState } from 'react';
import type { Bill, MoneySummary } from '../../../shared/types';
import { api } from '../api';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import './Bills.css';

const eur = (cents: number) => {
  const [int, dec] = (Math.abs(cents) / 100).toFixed(2).split('.');
  return `€${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${dec}`;
};
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
    <button className="card money-card bills-card" onClick={onOpen} aria-label={`Bills: ${b.paid} of ${total} paid`}>
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
                      </span>
                      {x.change && <span className={`bill-change ${x.change.to > x.change.from ? 'rise' : 'fall'}`}>{x.change.to > x.change.from ? '▲' : '▼'} was {eur(x.change.from)}</span>}
                    </span>
                    <span className="bill-amount">{x.status !== 'paid' && x.varying ? '~' : ''}{eur(x.amount)}</span>
                  </button>
                  {open === x.key && (
                    <div className="bill-more">
                      <span className="muted small">Last charges</span>
                      <ul className="bill-history">
                        {x.history.map((h) => <li key={h.date}><span>{shortDate(h.date)} {h.date.slice(0, 4) !== data.month.slice(0, 4) ? h.date.slice(0, 4) : ''}</span><span>{eur(h.amount)}</span></li>)}
                      </ul>
                      {x.tracked ? (
                        <button className="chip" disabled={busy === x.key} onClick={() => act('untrack', x.key, x.name)}>Stop tracking</button>
                      ) : (
                        <button className="chip" disabled={busy === x.key} onClick={() => act('ignore', x.key, x.name)}>Not a bill</button>
                      )}
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
                    <button className="chip" disabled={busy === c.key} onClick={() => act('track', c.key, c.name)}>Track</button>
                  </div>
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

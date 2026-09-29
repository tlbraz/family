import { useCallback, useEffect, useRef, useState } from 'react';
import type { MoneyBudget, MoneyGroup, MoneySummary, MoneyTransaction } from '../../../shared/types';
import { api } from '../api';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

// Category colours, validated for colour-blind separation on the light and dark cards (see styles.css --m1…--m8).
// A group keeps its colour by its place in Actual, not by how much was spent; past the 8th it folds into "Other".
const SLOTS = 8;
const colourOf = (id: string, order: string[]) => {
  const i = order.indexOf(id);
  return i >= 0 && i < SLOTS ? `var(--m${i + 1})` : 'var(--m-other)';
};

const eur = (cents: number, decimals = false) => {
  const v = Math.abs(cents) / 100;
  const [int, dec] = (decimals ? v.toFixed(2) : Math.round(v).toString()).split('.');
  return `${cents < 0 ? '−' : ''}€${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${dec ? `.${dec}` : ''}`;
};
const monthName = (m: string) => new Date(`${m}-15T12:00`).toLocaleDateString('en-GB', { month: 'long', year: m.slice(0, 4) === String(new Date().getFullYear()) ? undefined : 'numeric' });
const shortDate = (d: string) => new Date(`${d}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const ago = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};

export function MoneyView({ meName }: { meName: string }) {
  const [budget, setBudget] = useState<MoneyBudget>('family');
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<MoneySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<MoneyGroup | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.money(budget, month).then(setData).catch((e: Error) => setError(e.message));
  }, [budget, month]);
  useEffect(load, [load]);

  async function refresh() {
    setBusy(true);
    await api.refreshMoney().catch(() => {});
    setBusy(false);
    load();
  }

  const at = data ? data.months.indexOf(data.month) : -1;
  const [slide, setSlide] = useState<'' | 'from-left' | 'from-right'>('');
  function go(step: number) {
    const next = data?.months[at + step];
    if (!next) return;
    setMonth(next);
    setSlide(step > 0 ? 'from-right' : 'from-left');
  }
  const company = budget === 'company';

  // Swipe right for the previous month, left for the next (same feel as the calendar).
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1 || (e.target as HTMLElement).closest('.segmented')) return;
    touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY, t: Date.now() };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = e.changedTouches[0]!.clientX - start.x;
    const dy = e.changedTouches[0]!.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - start.t > 800) return;
    go(dx < 0 ? 1 : -1);
  }

  return (
    <div className="money" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="cal-head">
        <div className="cal-title">
          <span className="eyebrow">{company ? `Only ${meName} sees this` : 'Only parents see this'}</span>
          <h1>Money</h1>
        </div>
        {data && (
          <div className="month-switch">
            <button className="round ghost" aria-label="Previous month" disabled={at <= 0} onClick={() => go(-1)}>
              <Icon name="left" />
            </button>
            <button className="round ghost" aria-label="Next month" disabled={at >= data.months.length - 1} onClick={() => go(1)}>
              <Icon name="right" />
            </button>
          </div>
        )}
      </header>

      {data && data.budgets.length > 1 && (
        <div className="segmented money-switch" role="group" aria-label="Budget">
          {data.budgets.map((b) => (
            <button key={b} className={budget === b ? 'on' : ''} aria-pressed={budget === b} onClick={() => { setBudget(b); setData(null); }}>
              {b === 'family' ? 'Família' : 'Empresa'}
            </button>
          ))}
        </div>
      )}

      {error && (
        <section className="card money-card">
          <p className="error">{error}</p>
          <button className="chip" onClick={refresh} disabled={busy}>{busy ? 'Trying…' : 'Try again'}</button>
        </section>
      )}
      {!data && !error && <p className="muted">Reading Actual…</p>}

      {data && (
        <div key={data.month} className={`money-cards slide ${slide}`} onAnimationEnd={() => setSlide('')}>
          <SpentCard data={data} />
          <ReviewCard review={data.review} onOpen={() => setReviewing(true)} />
          <GroupsCard data={data} onOpen={setOpen} />
          <AccountsCard data={data} busy={busy} onRefresh={refresh} />
        </div>
      )}
      {open && data && <GroupSheet group={open} data={data} onClose={() => setOpen(null)} />}
      {reviewing && data && (
        <Sheet title={`To review · ${data.review.length}`} onClose={() => setReviewing(false)}>
          <TxList tx={data.review} showCategory />
          {data.link && <p className="muted small money-note">Check them in <a href={data.link} target="_blank" rel="noreferrer">Actual</a> and remove the #review tag from the notes.</p>}
        </Sheet>
      )}
    </div>
  );
}

function SpentCard({ data }: { data: MoneySummary }) {
  const { spent, usual, today } = data;
  const scale = Math.max(spent, usual ?? 0) * 1.15 || 1;
  const diff = usual === null ? 0 : usual - spent;
  return (
    <section className="card money-card">
      <div className="row">
        <span className="eyebrow">{monthName(data.month)} · {today ? 'spent so far' : 'spent'}</span>
        {today && <span className="pill">day {today} of {data.daysInMonth}</span>}
      </div>
      <div className="hero-num">{eur(spent)}</div>
      <div className="meter" role="img" aria-label={usual === null ? `Spent ${eur(spent)}` : `Spent ${eur(spent)}, usually ${eur(usual)}`}>
        <span style={{ width: `${(spent / scale) * 100}%` }} />
        {usual !== null && <i style={{ left: `${(usual / scale) * 100}%` }} />}
      </div>
      {usual === null ? (
        <p className="muted small">A comparison with a usual month appears once there's a full month of history.</p>
      ) : (
        <div className="row small">
          <span className="muted">Usually <b className="ink">~{eur(usual)}</b> {today ? 'by now' : 'in a month'}</span>
          <b>{diff >= 0 ? `${eur(diff)} under ✓` : `${eur(-diff)} over`}</b>
        </div>
      )}
    </section>
  );
}

function Donut({ groups, order, total }: { groups: MoneyGroup[]; order: string[]; total: number }) {
  const size = 210, r = size / 2 - 16, c = size / 2, gap = groups.length > 1 ? 0.02 : 0;
  let a = -Math.PI / 2;
  const at = (t: number) => `${c + r * Math.cos(t)} ${c + r * Math.sin(t)}`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Spending by category">
      {groups.map((g) => {
        const span = (g.amount / total) * Math.PI * 2;
        const a0 = a + gap / 2, a1 = a + Math.min(span, Math.PI * 2 - 0.0001) - gap / 2;
        a += span;
        return (
          <path key={g.id} d={`M ${at(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${at(a1)}`} stroke={colourOf(g.id, order)} strokeWidth={26} fill="none">
            <title>{`${g.name} ${eur(g.amount)}`}</title>
          </path>
        );
      })}
      <text x={c} y={c - 4} textAnchor="middle" className="donut-total">{eur(total)}</text>
      <text x={c} y={c + 18} textAnchor="middle" className="donut-sub">spent</text>
    </svg>
  );
}

function GroupsCard({ data, onOpen }: { data: MoneySummary; onOpen: (g: MoneyGroup) => void }) {
  const total = data.groups.reduce((s, g) => s + g.amount, 0);
  if (!total) {
    return (
      <section className="card money-card">
        <h2>Where it went</h2>
        <p className="muted small">No spending in {monthName(data.month)}.</p>
      </section>
    );
  }
  const max = Math.max(...data.groups.map((g) => g.amount));
  return (
    <section className="card money-card">
      <h2>Where it went</h2>
      <div className="donut-wrap"><Donut groups={data.groups} order={data.groupOrder} total={total} /></div>
      <ul className="legend">
        {data.groups.map((g) => (
          <li key={g.id}>
            <button onClick={() => onOpen(g)}>
              <span className="dot" style={{ background: colourOf(g.id, data.groupOrder) }} />
              <span className="name">{g.name}<span className="pct">{Math.round((g.amount / total) * 100)}%</span></span>
              <span className="amt">{eur(g.amount)}</span>
              <span className="track"><span style={{ width: `${(g.amount / max) * 100}%`, background: colourOf(g.id, data.groupOrder) }} /></span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">Tap a category to see what's inside it.</p>
    </section>
  );
}

function GroupSheet({ group, data, onClose }: { group: MoneyGroup; data: MoneySummary; onClose: () => void }) {
  const colour = colourOf(group.id, data.groupOrder);
  const max = Math.max(...group.categories.map((c) => c.amount));
  const tx = data.transactions.filter((t) => t.groupId === group.id);
  return (
    <Sheet title={`${group.name} · ${eur(group.amount)}`} onClose={onClose}>
      {group.categories.length > 1 && (
        <ul className="legend sub">
          {group.categories.map((c) => (
            <li key={c.id}>
              <span className="name">{c.name}<span className="pct">{Math.round((c.amount / group.amount) * 100)}%</span></span>
              <span className="amt">{eur(c.amount)}</span>
              <span className="track"><span style={{ width: `${(c.amount / max) * 100}%`, background: colour }} /></span>
            </li>
          ))}
        </ul>
      )}
      <TxList tx={tx} showCategory={group.categories.length > 1} />
      {group.id === 'uncategorised' && data.link && (
        <p className="muted small money-note">Give these a category in <a href={data.link} target="_blank" rel="noreferrer">Actual</a> and they'll move to the right place.</p>
      )}
    </Sheet>
  );
}

function TxList({ tx, showCategory }: { tx: MoneyTransaction[]; showCategory: boolean }) {
  return (
    <ul className="money-list">
      {tx.map((t, i) => (
        <li key={i}>
          <span>
            {t.payee || '—'}
            <span className="sub">{shortDate(t.date)} · {t.account}{showCategory ? ` · ${t.category}` : ''}</span>
          </span>
          {/* Spending is positive here; money in shows with a plus. */}
          <span className={`amt ${t.amount < 0 ? 'in' : ''}`}>{t.amount < 0 ? `+${eur(-t.amount, true)}` : eur(t.amount, true)}</span>
        </li>
      ))}
    </ul>
  );
}

function ReviewCard({ review, onOpen }: { review: MoneyTransaction[]; onOpen: () => void }) {
  if (!review.length) {
    return (
      <section className="card money-card review done">
        <Icon name="check" size={18} /> <span>Nothing to review</span>
      </section>
    );
  }
  return (
    <button className="card money-card review" onClick={onOpen}>
      <span className="review-count">{review.length}</span>
      <span className="review-text">
        <b>{review.length === 1 ? 'transaction' : 'transactions'} to review</b>
        <span className="muted small">tagged #review in Actual</span>
      </span>
      <Icon name="right" />
    </button>
  );
}

function AccountsCard({ data, busy, onRefresh }: { data: MoneySummary; busy: boolean; onRefresh: () => void }) {
  const onBudget = data.accounts.filter((a) => !a.offBudget);
  const offBudget = data.accounts.filter((a) => a.offBudget);
  return (
    <section className="card money-card">
      <div className="row">
        <h2>Accounts</h2>
        <button className="pill" onClick={onRefresh} disabled={busy} title="Read Actual again">
          {busy ? 'reading…' : `updated ${ago(data.fetchedAt)}`}
        </button>
      </div>
      <ul className="money-list">
        {onBudget.map((a) => (
          <li key={a.name}><span>{a.name}</span><span className={`amt ${a.balance < 0 ? 'neg' : ''}`}>{eur(a.balance)}</span></li>
        ))}
        {onBudget.length > 1 && (
          <li><b>Total</b><span className="amt">{eur(onBudget.reduce((s, a) => s + a.balance, 0))}</span></li>
        )}
      </ul>
      {offBudget.length > 0 && (
        <>
          <p className="eyebrow money-sub">Savings &amp; investments</p>
          <ul className="money-list">
            {offBudget.map((a) => (
              <li key={a.name}><span>{a.name}</span><span className="amt">{eur(a.balance)}</span></li>
            ))}
          </ul>
        </>
      )}
      {data.link && (
        <p className="muted small">Categorise and fix things in <a href={data.link} target="_blank" rel="noreferrer">Actual</a>.</p>
      )}
    </section>
  );
}

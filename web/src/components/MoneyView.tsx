import { useCallback, useEffect, useRef, useState } from 'react';
import type { MoneyBudget, MoneyGroup, MoneyHolding, MoneyHoldings, MoneySummary, MoneyTransaction } from '../../../shared/types';
import { api } from '../api';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

// Category colours, validated for colour-blind separation on the light and dark cards (see styles.css --m1…--m12).
// A group keeps its colour by its place in Actual (among the groups in use), not by how much was spent; past the
// 12th it goes gray. Every colour has its name next to it, so colour is never the only way to tell them apart.
const SLOTS = 12;
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
// "today at 13:02", "yesterday at 19:00" or "28 Sept at 07:00".
const when = (iso: string) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  return `${days === 0 ? 'today' : days === 1 ? 'yesterday' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at ${time}`;
};
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
  const [source, setSource] = useState<string | null>(null); // an income source, to list its transactions
  const [holdingsOpen, setHoldingsOpen] = useState(false);
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
        <>
          <BalanceCard data={data} busy={busy} onRefresh={refresh} />
          <div className="month-bar">
            <button className="round ghost" aria-label="Previous month" disabled={at <= 0} onClick={() => go(-1)}>
              <Icon name="left" />
            </button>
            <span>{monthName(data.month)}</span>
            <button className="round ghost" aria-label="Next month" disabled={at >= data.months.length - 1} onClick={() => go(1)}>
              <Icon name="right" />
            </button>
          </div>
          <div key={data.month} className={`money-cards slide ${slide}`} onAnimationEnd={() => setSlide('')}>
            <SpentCard data={data} />
            <ReviewCard review={data.review} onOpen={() => setReviewing(true)} />
            <GroupsCard data={data} onOpen={setOpen} />
            <IncomeCard data={data} onOpen={setSource} />
          </div>
          <SavingsCard data={data} onHoldings={budget === 'family' ? () => setHoldingsOpen(true) : undefined} />
          <p className="money-synced">
            {data.bankSyncedAt ? `Banks synced ${when(data.bankSyncedAt)}` : 'Banks not synced yet'} · read from Actual {ago(data.fetchedAt)}
          </p>
        </>
      )}
      {open && data && (
        <GroupSheet
          group={data.groups.find((g) => g.id === open.id) ?? { ...open, amount: 0, categories: [] }}
          data={data}
          edit={{ data, budget, onChanged: load }}
          onClose={() => setOpen(null)}
        />
      )}
      {source && data && (
        <Sheet title={`${source} · ${eur(data.income.sources.find((x) => x.name === source)?.amount ?? 0)}`} onClose={() => setSource(null)}>
          <TxList tx={data.income.transactions.filter((t) => sourceOf(t) === source)} showCategory={false} edit={{ data, budget, onChanged: load }} />
        </Sheet>
      )}
      {holdingsOpen && <HoldingsSheet onClose={() => setHoldingsOpen(false)} onSaved={load} />}
      {reviewing && data && <ReviewSheet data={data} budget={budget} onChanged={load} onClose={() => setReviewing(false)} />}
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
        <span className="eyebrow">{today ? 'Spent so far' : 'Spent'}</span>
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

function GroupSheet({ group, data, edit, onClose }: { group: MoneyGroup; data: MoneySummary; edit: Editing; onClose: () => void }) {
  const [only, setOnly] = useState<string | null>(null); // a category name, to see just its transactions
  const colour = colourOf(group.id, data.groupOrder);
  const max = Math.max(...group.categories.map((c) => c.amount));
  const tx = data.transactions.filter((t) => t.groupId === group.id && (!only || t.category === only));
  const several = group.categories.length > 1;
  return (
    <Sheet title={`${group.name} · ${eur(group.amount)}`} onClose={onClose}>
      {several && (
        <ul className="legend sub">
          {group.categories.map((c) => (
            <li key={c.id}>
              <button className={only && only !== c.name ? 'dim' : ''} aria-pressed={only === c.name} onClick={() => setOnly(only === c.name ? null : c.name)}>
                <span className="name">{c.name}<span className="pct">{Math.round((c.amount / group.amount) * 100)}%</span></span>
                <span className="amt">{eur(c.amount)}</span>
                <span className="track"><span style={{ width: `${(c.amount / max) * 100}%`, background: colour }} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {several && (
        <div className="row money-tx-head">
          <h3>{only ?? 'All transactions'}<span className="muted"> · {tx.length}</span></h3>
          {only ? <button className="chip" onClick={() => setOnly(null)}>Show all</button> : <span className="muted small">Tap a category to filter</span>}
        </div>
      )}
      <TxList tx={tx} showCategory={several && !only} edit={edit} />
      {!tx.length && <p className="muted small">Nothing here any more.</p>}
      {group.id === 'uncategorised' && data.link && (
        <p className="muted small money-note">Give these a category in <a href={data.link} target="_blank" rel="noreferrer">Actual</a> and they'll move to the right place.</p>
      )}
    </Sheet>
  );
}

/** What a list needs to let you change a transaction (category, #review) in place. */
interface Editing {
  data: MoneySummary;
  budget: MoneyBudget;
  onChanged: () => void;
}

function TxList({ tx, showCategory, edit }: { tx: MoneyTransaction[]; showCategory: boolean; edit?: Editing }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <ul className="money-list review-list">
      {tx.map((t, i) => {
        const canEdit = !!(edit && t.id);
        const row = (
          <>
            <span>
              {t.payee || '—'}
              {t.note && <span className="tx-desc">{t.note}</span>}
              <span className="sub">
                {shortDate(t.date)} · {t.account}{showCategory ? ` · ${t.category}` : ''}
                {t.review && <span className="tag"> #review</span>}
              </span>
            </span>
            {/* Spending is positive here; money in shows with a plus. */}
            <span className={`amt ${t.amount < 0 ? 'in' : ''}`}>{t.amount < 0 ? `+${eur(-t.amount, true)}` : eur(t.amount, true)}</span>
          </>
        );
        return (
          <li key={t.id ?? i} className={openId === t.id ? 'open' : ''}>
            {canEdit ? (
              <button className="review-row" aria-expanded={openId === t.id} onClick={() => setOpenId(openId === t.id ? null : t.id!)}>{row}</button>
            ) : (
              <div className="review-row">{row}</div>
            )}
            {canEdit && openId === t.id && <TxEditor t={t} edit={edit!} onDone={() => setOpenId(null)} />}
          </li>
        );
      })}
    </ul>
  );
}

/** Pick a category: one field showing the current one; tap or type to open a short list of matches. */
function CategoryPicker({ data, value, onChange }: { data: MoneySummary; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const q = fold(query.trim());
  const all = data.pickable.flatMap((g) => g.categories.map((c) => ({ ...c, group: g.name })));
  const matches = q ? all.filter((c) => fold(c.name).includes(q) || fold(c.group).includes(q)) : all;
  const current = all.find((c) => c.id === value);
  function choose(id: string) {
    onChange(id);
    setOpen(false);
    setQuery('');
  }
  return (
    <div className="cat-picker">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label="Category"
        value={open ? query : current ? `${current.name} · ${current.group}` : ''}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) { e.preventDefault(); choose(matches[0].id); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
        placeholder={current ? `${current.name} · ${current.group}` : 'Category…'}
        autoComplete="off"
      />
      {open && (
        <ul role="listbox" aria-label="Categories">
          {matches.map((c) => (
            <li key={c.id} role="option" aria-selected={c.id === value} className={c.id === value ? 'on' : ''}
              onMouseDown={(e) => e.preventDefault()} onClick={() => choose(c.id)}>
              <b>{c.name}</b> <span>{c.group}</span>
            </li>
          ))}
          {!matches.length && <li className="none">No category matches "{query}"</li>}
        </ul>
      )}
    </div>
  );
}

/** Change one transaction: its category and whether it's tagged #review. Saved in Actual. */
function TxEditor({ t, edit, onDone }: { t: MoneyTransaction; edit: Editing; onDone: () => void }) {
  const [pick, setPick] = useState(t.categoryId ?? '');
  const [review, setReview] = useState(!!t.review);
  const [note, setNote] = useState(t.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = {
    ...(t.fixable && pick && pick !== t.categoryId ? { category: pick } : {}),
    ...(review !== !!t.review ? { review } : {}),
    ...(note.trim() !== (t.note ?? '') ? { note: note.trim() } : {}),
  };
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.editMoney(edit.budget, t.id!, change);
      onDone();
      edit.onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="review-fix">
      {t.fixable ? (
        <CategoryPicker data={edit.data} value={pick} onChange={setPick} />
      ) : (
        <p className="muted small">Part of a split: change its category in Actual.</p>
      )}
      <input className="tx-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Description (optional)" maxLength={500} aria-label="Description" />
      <label className="check">
        <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Needs review (#review)
      </label>
      {error && <p className="error small">{error}</p>}
      <div className="review-actions">
        <button className="chip" onClick={onDone} disabled={busy}>Cancel</button>
        <button className="primary" onClick={save} disabled={busy || !Object.keys(change).length}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

/** Go through the #review transactions: fix the category or description (or keep them) and the tag comes out, in Actual. */
function ReviewSheet({ data, budget, onChanged, onClose }: { data: MoneySummary; budget: MoneyBudget; onChanged: () => void; onClose: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]); // reviewed here, hidden before the page reloads
  const left = data.review.filter((t) => !done.includes(t.id!));

  function toggle(t: MoneyTransaction) {
    setError(null);
    setOpenId(openId === t.id ? null : t.id!);
    setPick(t.categoryId ?? '');
    setNote(t.note ?? '');
  }
  const changes = (t: MoneyTransaction) => ({
    ...(t.fixable && pick && pick !== t.categoryId ? { category: pick } : {}),
    ...(note.trim() !== (t.note ?? '') ? { note: note.trim() } : {}),
  });
  async function finish(t: MoneyTransaction) {
    setBusy(true);
    setError(null);
    try {
      await api.editMoney(budget, t.id!, { ...changes(t), review: false });
      setDone((d) => [...d, t.id!]);
      setOpenId(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={left.length ? `To review · ${left.length}` : 'All reviewed'} onClose={onClose}>
      {!left.length && <p className="muted">Nothing left to review ✓</p>}
      <ul className="money-list review-list">
        {left.map((t) => (
          <li key={t.id} className={openId === t.id ? 'open' : ''}>
            <button className="review-row" aria-expanded={openId === t.id} onClick={() => toggle(t)}>
              <span>
                {t.payee || '—'}
                {t.note && <span className="tx-desc">{t.note}</span>}
                <span className="sub">{shortDate(t.date)} · {t.account} · {t.category}</span>
              </span>
              <span className={`amt ${t.amount < 0 ? 'in' : ''}`}>{t.amount < 0 ? `+${eur(-t.amount, true)}` : eur(t.amount, true)}</span>
            </button>
            {openId === t.id && (
              <div className="review-fix">
                {t.fixable ? (
                  <CategoryPicker data={data} value={pick} onChange={setPick} />
                ) : (
                  <p className="muted small">A split or a transfer: change its category in Actual.</p>
                )}
                <input className="tx-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Description (optional)" maxLength={500} aria-label="Description" />
                {error && <p className="error small">{error}</p>}
                <div className="review-actions">
                  <button className="chip" disabled={busy} onClick={() => setOpenId(null)}>Cancel</button>
                  <button className="primary" disabled={busy} onClick={() => finish(t)}>
                    {busy ? 'Saving…' : Object.keys(changes(t)).length ? 'Save ✓' : 'Looks fine ✓'}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small money-note">Saving sets the category and description in Actual and takes #review out of the note.</p>
    </Sheet>
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

/** How much we have now: the biggest number on the page. Doesn't change with the month being looked at. */
// For money in, the server puts the source's name (an income category, who paid, or "Not categorised") in `category`.
const sourceOf = (t: MoneyTransaction) => t.category;

/** What came in this month, and how much of it is left after spending. */
function IncomeCard({ data, onOpen }: { data: MoneySummary; onOpen: (source: string) => void }) {
  const { total, sources } = data.income;
  const kept = total - data.spent;
  const max = Math.max(...sources.map((x) => x.amount), 1);
  return (
    <section className="card money-card">
      <h2>Came in</h2>
      {total === 0 ? (
        <p className="muted small">Nothing came in {data.today ? 'yet this month' : `in ${monthName(data.month)}`}.</p>
      ) : (
        <>
          <div className="income-num">{eur(total)}</div>
          <p className={`income-kept ${kept >= 0 ? 'good' : 'bad'}`}>
            {kept >= 0 ? `${eur(kept)} left after spending` : `${eur(-kept)} more spent than came in`}
          </p>
          <ul className="legend sub income">
            {sources.map((x) => (
              <li key={x.name}>
                <button onClick={() => onOpen(x.name)}>
                  <span className="name">{x.name}</span>
                  <span className="amt">{eur(x.amount)}</span>
                  <span className="track"><span style={{ width: `${(Math.max(x.amount, 0) / max) * 100}%` }} /></span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// Off-budget accounts: positive ones are savings and investments; negative ones are debts (the mortgage), which
// stay in their own lane and are never added to or taken from any total.
const saving = (d: MoneySummary) => d.accounts.filter((a) => a.offBudget && a.balance >= 0);
const debts = (d: MoneySummary) => d.accounts.filter((a) => a.offBudget && a.balance < 0);

function BalanceCard({ data, busy, onRefresh }: { data: MoneySummary; busy: boolean; onRefresh: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const onBudget = data.accounts.filter((a) => !a.offBudget);
  const total = onBudget.reduce((s, a) => s + a.balance, 0);
  const saved = saving(data).reduce((s, a) => s + a.balance, 0);
  return (
    <section className="card money-card balance">
      <div className="row">
        <span className="eyebrow">Available now</span>
        <button className="pill" onClick={onRefresh} disabled={busy} title="Read Actual again">
          {busy ? 'reading…' : `updated ${ago(data.fetchedAt)}`}
        </button>
      </div>
      <div className={`balance-num ${total < 0 ? 'neg' : ''}`}>{eur(total)}</div>
      {saved > 0 && <p className="balance-saved">+ {eur(saved)} in savings &amp; investments</p>}
      <button className="balance-toggle" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
        {showAll ? 'Hide accounts' : `${onBudget.length} account${onBudget.length === 1 ? '' : 's'}`}
        <Icon name={showAll ? 'up' : 'down'} size={16} />
      </button>
      {showAll && (
        <>
          <ul className="money-list">
            {onBudget.map((a) => (
              <li key={a.name}><span>{a.name}</span><span className={`amt ${a.balance < 0 ? 'neg' : ''}`}>{eur(a.balance)}</span></li>
            ))}
          </ul>
          {data.link && (
            <p className="muted small">Categorise and fix things in <a href={data.link} target="_blank" rel="noreferrer">Actual</a>.</p>
          )}
        </>
      )}
    </section>
  );
}

/** Savings and investments (off-budget accounts), with debts like the mortgage kept apart. */
function SavingsCard({ data, onHoldings }: { data: MoneySummary; onHoldings?: () => void }) {
  const list = saving(data).sort((a, b) => b.balance - a.balance);
  const owed = debts(data);
  if (!list.length && !owed.length) return null;
  const total = list.reduce((s, a) => s + a.balance, 0);
  const max = Math.max(...list.map((a) => a.balance), 1);
  return (
    <section className="card money-card">
      <div className="row">
        <h2>Savings &amp; investments</h2>
        {onHoldings && <button className="pill" onClick={onHoldings}>Update values</button>}
      </div>
      {list.length > 0 && (
        <>
          <div className="income-num">{eur(total)}</div>
          <ul className="legend sub savings">
            {list.map((a) => (
              <li key={a.name}>
                <span className="name">{a.name}<span className="pct">{Math.round((a.balance / total) * 100)}%</span></span>
                <span className="amt">{eur(a.balance)}</span>
                <span className="track"><span style={{ width: `${(a.balance / max) * 100}%` }} /></span>
              </li>
            ))}
          </ul>
        </>
      )}
      {owed.length > 0 && (
        <div className="debt-lane">
          {owed.map((a) => (
            <div key={a.name} className="row">
              <span>{a.name}</span>
              <span className="amt">{eur(-a.balance)} owed</span>
            </div>
          ))}
          <p className="muted small">Kept apart: not counted in any total.</p>
        </div>
      )}
    </section>
  );
}

/** What each investment account holds; the app values them daily (units × today's price) and writes that to Actual. */
function HoldingsSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  type Row = { id: string; units: string };
  type Draft = { account: string; items: Row[]; cash: string };
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [info, setInfo] = useState<MoneyHoldings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fromHoldings = (h: MoneyHolding[]): Draft[] =>
    h.map((a) => ({ account: a.account, items: a.items.map((i) => ({ id: i.id, units: String(i.units) })), cash: a.cash ? String(a.cash) : '' }));
  useEffect(() => {
    api.holdings().then((h) => { setInfo(h); setDraft(fromHoldings(h.holdings)); }).catch((e: Error) => setError(e.message));
  }, []);

  const set = (i: number, patch: Partial<Draft>) => setDraft((d) => d!.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const setRow = (i: number, r: number, patch: Partial<Row>) => set(i, { items: draft![i]!.items.map((x, k) => (k === r ? { ...x, ...patch } : x)) });

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const holdings: MoneyHolding[] = draft!.map((a) => ({
        account: a.account,
        items: a.items.filter((x) => x.id.trim()).map((x) => ({ id: x.id, units: Number(x.units.replace(',', '.')) })),
        cash: Number((a.cash || '0').replace(',', '.')),
      }));
      const res = await api.saveHoldings(holdings);
      setInfo((i) => ({ ...res, accounts: i?.accounts ?? [] }));
      setDraft(fromHoldings(res.holdings));
      setSaved(true);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Holdings" onClose={onClose}>
      <p className="muted small">
        What each account holds. Every morning the app works out units × today's price and sets the account in Actual. Use an
        ISIN (PPR, funds) or a Yahoo symbol in euros (MSF.DE, IWDA.AS, ETH-EUR). Update the units when you buy or sell.
      </p>
      {!draft && !error && <p className="muted">Loading…</p>}
      <datalist id="money-accounts">{info?.accounts.map((a) => <option key={a} value={a} />)}</datalist>
      {draft?.map((a, i) => (
        <section key={i} className="holding">
          <div className="holding-head">
            <input value={a.account} onChange={(e) => set(i, { account: e.target.value })} list="money-accounts" placeholder="Account in Actual" aria-label="Account in Actual" />
            <button type="button" className="round ghost" aria-label={`Remove ${a.account || 'account'}`} onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
              <Icon name="trash" size={16} />
            </button>
          </div>
          {a.items.map((x, r) => (
            <div key={r} className="holding-row">
              <input value={x.id} onChange={(e) => setRow(i, r, { id: e.target.value.toUpperCase() })} placeholder="ISIN or symbol" aria-label="ISIN or symbol" autoCapitalize="characters" />
              <input value={x.units} onChange={(e) => setRow(i, r, { units: e.target.value })} placeholder="Units" aria-label="Units" inputMode="decimal" />
              <button type="button" className="round ghost" aria-label="Remove line" onClick={() => set(i, { items: a.items.filter((_, k) => k !== r) })}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
          <div className="holding-row">
            <button type="button" className="chip" onClick={() => set(i, { items: [...a.items, { id: '', units: '' }] })}>
              <Icon name="plus" size={14} /> Fund / ETF
            </button>
            <input value={a.cash} onChange={(e) => set(i, { cash: e.target.value })} placeholder="Cash €" aria-label="Cash in euros" inputMode="decimal" />
          </div>
          {info?.last[a.account] && (
            <p className="muted small">Valued {shortDate(info.last[a.account]!.date)}: {info.last[a.account]!.note}</p>
          )}
        </section>
      ))}
      {draft && (
        <button type="button" className="chip" onClick={() => setDraft([...draft, { account: '', items: [{ id: '', units: '' }], cash: '' }])}>
          <Icon name="plus" size={14} /> Account
        </button>
      )}
      {error && <p className="error small">{error}</p>}
      {saved && !error && <p className="small good-note">Saved, and valued with today's prices ✓</p>}
      <div className="review-actions holding-save">
        <button className="primary" onClick={save} disabled={busy || !draft}>{busy ? 'Saving and valuing…' : 'Save'}</button>
      </div>
    </Sheet>
  );
}

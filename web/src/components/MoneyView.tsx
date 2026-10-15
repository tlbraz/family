import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MoneyBudget, MoneyGroup, MoneyHolding, MoneyHoldings, MoneySummary, MoneyTransaction, MoneyWorth } from '../../../shared/types';
import { api } from '../api';
import { useBack } from '../back';
import { BillsCard, BillsSheet, FixedForm, fixedFor } from './Bills';
import { Icon } from './Icon';
import { categoryIcon } from './categoryIcons';
import { groupColours, splitGroup } from './moneyColours';
import { Sheet } from './Sheet';

// Bills (fixed vs variable) are paused while they get a new design: no card, sheet or "fixed expense" button.
const SHOW_BILLS = false;


type TopItem = MoneyGroup & { children?: MoneyGroup[] };
function levels(data: MoneySummary) {
  const { keyColour, colour } = groupColours(data);
  const tops = new Map<string, TopItem>();
  for (const g of data.groups) {
    const parts = splitGroup(g.name);
    if (!parts) {
      tops.set(g.id, g);
      continue;
    }
    const key = `top:${parts.top}`;
    const t = tops.get(key) ?? { id: key, name: parts.top, amount: 0, categories: [], children: [] };
    t.amount += g.amount;
    t.children!.push({ ...g, name: parts.sub });
    tops.set(key, t);
  }
  const items = [...tops.values()]
    .map((t) => (t.children?.length ? { ...t, children: t.children.sort((a, b) => b.amount - a.amount) } : t))
    .sort((a, b) => (a.id === 'uncategorised' ? 1 : b.id === 'uncategorised' ? -1 : b.amount - a.amount));
  return { items, keyColour, colour };
}

const eur = (cents: number, decimals = false) => {
  const v = Math.abs(cents) / 100;
  const [int, dec] = (decimals ? v.toFixed(2) : Math.round(v).toString()).split('.');
  return `${cents < 0 ? '−' : ''}€${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${dec ? `.${dec}` : ''}`;
};
const monthName = (m: string) => new Date(`${m}-15T12:00`).toLocaleDateString('en-GB', { month: 'long', year: m.slice(0, 4) === String(new Date().getFullYear()) ? undefined : 'numeric' });
// The description, unless it only repeats the payee (banks often copy their text into the note). Lists show it first, the payee below.
const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
const descOf = (t: MoneyTransaction) => {
  const note = squash(t.note ?? '');
  const payee = squash(t.payee ?? '');
  return note && !(payee && (note.includes(payee) || payee.includes(note))) ? t.note : null;
};
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
  const [openTop, setOpenTop] = useState<TopItem | null>(null); // a top level ("Casa") with its groups
  const [reviewing, setReviewing] = useState(false);
  const [source, setSource] = useState<string | null>(null); // an income source, to list its transactions
  const [holdingsOpen, setHoldingsOpen] = useState(false);
  const [owedOpen, setOwedOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [billsOpen, setBillsOpen] = useState(false);
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
          <BalanceCard data={data} busy={busy} onRefresh={refresh} onOwed={() => setOwedOpen(true)} onHeld={() => setHeldOpen(true)} onChanged={load} />
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
            {SHOW_BILLS && <BillsCard data={data} onOpen={() => setBillsOpen(true)} />}
            <ReviewCard review={data.review} onOpen={() => setReviewing(true)} />
            <TransfersCard data={data} budget={budget} onChanged={load} />
            <GroupsCard data={data} onOpen={(g) => (g.children?.length ? setOpenTop(g) : setOpen(g))} />
            <IncomeCard data={data} onOpen={setSource} />
          </div>
          {data.worth && <WorthCard worth={data.worth} />}
          <SavingsCard data={data} onHoldings={budget === 'family' ? () => setHoldingsOpen(true) : undefined} />
          <p className="money-synced">
            {data.bankSyncedAt ? `Banks synced ${when(data.bankSyncedAt)}` : 'Banks not synced yet'} · read from Actual {ago(data.fetchedAt)}
          </p>
        </>
      )}
      {openTop && data && (
        <TopSheet
          top={levels(data).items.find((t) => t.id === openTop.id) ?? { ...openTop, amount: 0, children: [] }}
          data={data}
          edit={{ data, budget, onChanged: load }}
          onClose={() => setOpenTop(null)}
        />
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
      {owedOpen && data?.owed && (
        <Sheet title={`To come back · ${eur(data.owed.total)}`} onClose={() => setOwedOpen(false)}>
          {data.owed.open.length > 0 ? (
            <>
              <h3 className="sheet-sub">Not paid back yet</h3>
              <TxList tx={data.owed.open} showCategory={false} edit={{ data, budget, onChanged: load }} />
            </>
          ) : (
            <p className="muted">Everything has come back ✓</p>
          )}
          {(() => {
            // What's settled: money that came back and expenses fully paid back (the open ones are listed above).
            const open = new Set(data.owed.open.map((t) => t.id));
            const settled = data.owed.recent.filter((t) => !open.has(t.id));
            return settled.length > 0 && (
              <>
                <h3 className="sheet-sub">Paid back</h3>
                <TxList tx={settled} showCategory={false} edit={{ data, budget, onChanged: load }} />
              </>
            );
          })()}
          <p className="muted small money-note">
            Paid for the company (or anyone else) and to come back: categories in the "A receber" group, or with "reembolso" in the name. They don't count as spending. Give the money back the same category, and the oldest expenses count as paid first.
          </p>
        </Sheet>
      )}
      {heldOpen && data?.held && (
        <Sheet title={`To hand over · ${eur(data.held.total)}`} onClose={() => setHeldOpen(false)}>
          <TxList tx={data.held.recent} showCategory={false} edit={{ data, budget, onChanged: load }} />
          <p className="muted small money-note">
            Someone else's money passing through (raffle tickets sold, a collection…): categories in the "A entregar" group. It isn't income or spending. Give the hand-over the same category; what's left is still to hand over.
          </p>
        </Sheet>
      )}
      {SHOW_BILLS && billsOpen && data?.bills && <BillsSheet data={data} onChanged={load} onClose={() => setBillsOpen(false)} />}
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

function Donut({ groups, colour, total }: { groups: MoneyGroup[]; colour: (id: string) => string; total: number }) {
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
          <path key={g.id} d={`M ${at(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${at(a1)}`} stroke={colour(g.id)} strokeWidth={26} fill="none">
            <title>{`${g.name} ${eur(g.amount)}`}</title>
          </path>
        );
      })}
      <text x={c} y={c - 4} textAnchor="middle" className="donut-total">{eur(total)}</text>
      <text x={c} y={c + 18} textAnchor="middle" className="donut-sub">spent</text>
    </svg>
  );
}

function GroupsCard({ data, onOpen }: { data: MoneySummary; onOpen: (g: TopItem) => void }) {
  const total = data.groups.reduce((s, g) => s + g.amount, 0);
  if (!total) {
    return (
      <section className="card money-card">
        <h2>Where it went</h2>
        <p className="muted small">No spending in {monthName(data.month)}.</p>
      </section>
    );
  }
  const { items, keyColour: colour } = levels(data);
  const max = Math.max(...items.map((g) => g.amount));
  return (
    <section className="card money-card">
      <h2>Where it went</h2>
      <div className="donut-wrap"><Donut groups={items} colour={colour} total={total} /></div>
      <ul className="legend icons">
        {items.map((g) => (
          <li key={g.id}>
            <button onClick={() => onOpen(g)}>
              <span className="dot icon" style={{ color: colour(g.id) }}><Icon name={categoryIcon(g.name)} size={16} /></span>
              <span className="name">{g.name}<span className="pct">{Math.round((g.amount / total) * 100)}%</span></span>
              <span className="amt">{eur(g.amount)}</span>
              <span className="track"><span style={{ width: `${(g.amount / max) * 100}%`, background: colour(g.id) }} /></span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">Tap a category to see its transactions.</p>
    </section>
  );
}

/** A category's icon in its colour, for a sheet's title. */
const SheetIcon = ({ name, colour }: { name: string; colour: string }) => <span style={{ color: colour, display: 'flex' }}><Icon name={name} size={22} /></span>;

/** A top level ("Casa"): each of its groups ("Energia", "Habitação") with its categories and their transactions. */
function TopSheet({ top, data, edit, onClose }: { top: TopItem; data: MoneySummary; edit: Editing; onClose: () => void }) {
  const children = top.children ?? [];
  const colour = children[0] ? levels(data).colour(children[0].id) : 'var(--m-other)';
  const [all, toggleAll] = useOpenAll();
  return (
    <Sheet title={`${top.name} · ${eur(top.amount)}`} icon={<SheetIcon name={categoryIcon(top.name)} colour={colour} />} onClose={onClose}
      actions={children.length > 0 && <OpenAllButton all={all} onClick={toggleAll} />}>
      {!children.length && <p className="muted small">Nothing here any more.</p>}
      {children.map((g) => (
        <SubSection key={g.id} top={top} group={g} data={data} edit={edit} colour={colour} all={all} pct={children.length > 1 ? Math.round((g.amount / top.amount) * 100) : null} />
      ))}
    </Sheet>
  );
}

/** One group in a top level's sheet. When its only category is named like it ("Escola" > "Escola"), the heading opens the transactions itself. */
function SubSection({ top, group, data, edit, colour, pct, all }: { top: TopItem; group: MoneyGroup; data: MoneySummary; edit: Editing; colour: string; pct: number | null; all: OpenAll }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (all) setOpen(all.open); }, [all]);
  const names = categoryNames(group, data);
  const lone = names.length === 1 && names[0] === group.name;
  const inner = (
    <>
      <span className="cat-icon" style={{ color: colour }}><Icon name={categoryIcon(`${top.name} / ${group.name}`)} size={18} /></span>
      <h3>{group.name}{lone && <span className="muted"> · {data.transactions.filter((t) => t.groupId === group.id).length}</span>}</h3>
      {pct !== null && <span className="pct">{pct}%</span>}
      <span className="amt">{eur(group.amount)}</span>
      {lone && <span className="chev"><Icon name="right" size={14} /></span>}
    </>
  );
  return (
    <section className={`money-sub${open ? ' open' : ''}`}>
      {lone ? (
        <button className="money-sub-head" style={{ borderColor: colour }} aria-expanded={open} onClick={() => setOpen(!open)}>{inner}</button>
      ) : (
        <div className="money-sub-head" style={{ borderColor: colour }}>{inner}</div>
      )}
      {lone ? open && <div className="money-cat" style={{ '--c': colour } as CSSProperties}><TxList tx={data.transactions.filter((t) => t.groupId === group.id)} showCategory={false} edit={edit} /></div>
        : <CategoryTx group={group} data={data} edit={edit} colour={colour} all={all} />}
    </section>
  );
}

/** A group's category names that have transactions: Actual's order first, then any others the transactions name. */
function categoryNames(group: MoneyGroup, data: MoneySummary) {
  const tx = data.transactions.filter((t) => t.groupId === group.id);
  return [...new Set([...group.categories.map((c) => c.name), ...tx.map((t) => t.category)])].filter((n) => tx.some((t) => t.category === n));
}

/** A group's sheet. When its only category is named like it ("Sem categoria" > "Sem categoria"), the transactions straight away. */
function GroupSheet({ group, data, edit, onClose }: { group: MoneyGroup; data: MoneySummary; edit: Editing; onClose: () => void }) {
  const [all, toggleAll] = useOpenAll();
  const tx = data.transactions.filter((t) => t.groupId === group.id);
  const names = categoryNames(group, data);
  const lone = names.length === 1 && names[0] === group.name;
  const colour = levels(data).colour(group.id);
  return (
    <Sheet title={`${group.name} · ${eur(group.amount)}`} icon={<SheetIcon name={categoryIcon(group.name)} colour={colour} />} onClose={onClose}
      actions={tx.length > 0 && !lone && <OpenAllButton all={all} onClick={toggleAll} />}>
      {lone
        ? <TxList tx={tx} showCategory={false} edit={edit} />
        : <CategoryTx group={group} data={data} edit={edit} colour={colour} all={all} />}
    </Sheet>
  );
}

/** "Expand all" / "Collapse all" in a category sheet: each press is a new signal every section follows (they still open and close one by one too). */
type OpenAll = { open: boolean; n: number } | null;
function useOpenAll() {
  const [all, setAll] = useState<OpenAll>(null);
  return [all, () => setAll((a) => ({ open: !a?.open, n: (a?.n ?? 0) + 1 }))] as const;
}
function OpenAllButton({ all, onClick }: { all: OpenAll; onClick: () => void }) {
  const label = all?.open ? 'Collapse all' : 'Expand all';
  return (
    <button className="round ghost" onClick={onClick} aria-pressed={!!all?.open} aria-label={label} title={label}>
      <Icon name={all?.open ? 'collapse' : 'expand'} />
    </button>
  );
}

/** A group's categories, always listed (biggest first); tap one to show or hide its transactions. */
function CategoryTx({ group, data, edit, colour, all }: { group: MoneyGroup; data: MoneySummary; edit: Editing; colour: string; all?: OpenAll }) {
  const [shown, setShown] = useState<Set<string>>(new Set());
  useEffect(() => { if (all) setShown(all.open ? new Set(categoryNames(group, data)) : new Set()); }, [all]);
  const tx = data.transactions.filter((t) => t.groupId === group.id);
  if (!tx.length) return <p className="muted small">Nothing here any more.</p>;
  const names = categoryNames(group, data);
  const amountOf = (n: string) => group.categories.find((c) => c.name === n)?.amount ?? tx.filter((t) => t.category === n).reduce((s, t) => s + t.amount, 0);
  const toggle = (n: string) => setShown((old) => { const s = new Set(old); if (!s.delete(n)) s.add(n); return s; });
  return (
    <>
      {names.map((n) => {
        const mine = tx.filter((t) => t.category === n);
        const open = shown.has(n);
        return (
          <div key={n} className={`money-cat${open ? ' open' : ''}`} style={{ '--c': colour } as CSSProperties}>
            <button className="money-cat-head" aria-expanded={open} onClick={() => toggle(n)}>
              <span className="cat-icon"><Icon name={categoryIcon(n)} size={16} /></span>
              <span className="name">{n}<span className="muted"> · {mine.length}</span></span>
              <span className="amt">{eur(amountOf(n))}</span>
              <span className="chev"><Icon name="right" size={14} /></span>
            </button>
            {open && <TxList tx={mine} showCategory={false} edit={edit} />}
          </div>
        );
      })}
    </>
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
              {descOf(t) ?? (t.payee || '—')}
              <span className="sub">
                {splitLabel(t) ?? (descOf(t) && t.payee ? `${t.payee} · ` : '')}
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

/**
 * Pick a category: a field showing the current one (icon, name, where it sits). Tapping it brings up a panel from the
 * bottom with the whole tree: the top levels in their colours, their groups as small headings, the categories under
 * them. The keyboard only comes up if you tap the search. Picking one marks it and the panel slides away.
 */
function CategoryPicker({ data, value, onChange }: { data: MoneySummary; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = data.pickable.flatMap((g) => g.categories.map((c) => ({ ...c, groupId: g.id, group: g.name }))).find((c) => c.id === value);
  const parts = current ? splitGroup(current.group) : null;
  const where = current ? (parts ? (parts.sub === current.name ? parts.top : `${parts.top} › ${parts.sub}`) : current.group) : '';
  const colour = current ? groupColours(data).colour(current.groupId) : undefined;
  return (
    <>
      <button type="button" className="cat-field" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={current ? `Category: ${current.name}, ${where}. Change` : 'Pick a category'}>
        <span className="cat-field-icon" style={{ color: colour }}><Icon name={current ? categoryIcon(current.name) : 'tag'} size={18} /></span>
        <span className="cat-field-text">
          {current ? <b>{current.name}</b> : <span className="muted">Pick a category…</span>}
          {current && where !== current.name && <span className="muted small">{where}</span>}
        </span>
        <Icon name="down" size={16} />
      </button>
      {open && <CategorySheet data={data} value={value} onPick={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The tree of categories in a panel that slides up (and away again once one is picked). */
function CategorySheet({ data, value, onPick, onClose }: { data: MoneySummary; value: string; onPick: (id: string) => void; onClose: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setLeaving(true);
    setTimeout(onClose, 200);
  }, [onClose]);
  useBack(close);
  useEffect(() => {
    // Open on the current category.
    list.current?.querySelector('.cat-row.on')?.scrollIntoView({ block: 'center' });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);
  function pick(id: string) {
    setPicked(id);
    onPick(id);
    setTimeout(close, 160); // let the mark show for a moment
  }

  const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const q = fold(query.trim());
  const { colour } = groupColours(data);
  // Top level → groups → categories, in Actual's order. "Casa / Energia" sits under Casa; a group without "/" is its own top.
  // A group whose only category is named like it ("Casa / Manutenção" > "Manutenção") gets no heading of its own, and a
  // top level that is just one such category ("Outros" > "Outros") is picked by its own heading.
  type Branch = { key: string; name: string; colourOf: string; groups: { id: string; name: string | null; categories: { id: string; name: string }[] }[]; lone?: string };
  const tree: Branch[] = [];
  for (const g of data.pickable) {
    const parts = splitGroup(g.name);
    const topName = parts ? parts.top : g.name;
    const cats = g.categories.filter((c) => !q || fold(c.name).includes(q) || fold(g.name).includes(q));
    if (!cats.length) continue;
    let top = tree.find((t) => t.name === topName);
    if (!top) tree.push((top = { key: g.id, name: topName, colourOf: g.id, groups: [] }));
    const lone = g.categories.length === 1 && g.categories[0]!.name === (parts ? parts.sub : topName);
    top.groups.push({ id: g.id, name: parts && !lone ? parts.sub : null, categories: cats });
  }
  for (const t of tree) {
    const only = t.groups.length === 1 && !t.groups[0]!.name && t.groups[0]!.categories.length === 1 ? t.groups[0]!.categories[0]! : null;
    if (only?.name === t.name) t.lone = only.id;
  }
  const chosen = picked ?? value;

  return (
    <div className={`cat-scrim ${leaving ? 'out' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="cat-sheet" role="dialog" aria-modal="true" aria-label="Pick a category">
        <div className="cat-grip" aria-hidden="true" />
        <div className="cat-sheet-head">
          <div className="cat-search">
            <Icon name="search" size={16} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search categories" aria-label="Search categories" autoComplete="off" />
          </div>
          <button type="button" className="round ghost" aria-label="Close" onClick={close}><Icon name="close" /></button>
        </div>
        <div className="cat-tree" ref={list}>
          {!tree.length && <p className="muted small cat-none">No category matches "{query}".</p>}
          {tree.map((top) => (
            <section key={top.key} className="cat-top">
              {top.lone ? (
                <button type="button" className={`cat-top-head cat-top-pick ${top.lone === chosen ? 'on' : ''}`} aria-pressed={top.lone === chosen} onClick={() => pick(top.lone!)}>
                  <span className="cat-top-icon" style={{ color: colour(top.colourOf), background: `color-mix(in srgb, ${colour(top.colourOf)} 14%, transparent)` }}>
                    <Icon name={categoryIcon(top.name)} size={16} />
                  </span>
                  {top.name}
                  {top.lone === chosen && <Icon name="check" size={16} />}
                </button>
              ) : (
                <h3 className="cat-top-head">
                  <span className="cat-top-icon" style={{ color: colour(top.colourOf), background: `color-mix(in srgb, ${colour(top.colourOf)} 14%, transparent)` }}>
                    <Icon name={categoryIcon(top.name)} size={16} />
                  </span>
                  {top.name}
                </h3>
              )}
              {!top.lone && top.groups.map((g) => (
                <div key={g.id} className={`cat-group ${g.name ? 'with-head' : ''}`} style={{ borderColor: `color-mix(in srgb, ${colour(top.colourOf)} 45%, transparent)` }}>
                  {g.name && <h4 className="cat-sub-head">{g.name}</h4>}
                  {g.categories.map((c) => (
                    <button key={c.id} type="button" className={`cat-row ${c.id === chosen ? 'on' : ''}`} aria-pressed={c.id === chosen} onClick={() => pick(c.id)}>
                      <span className="cat-row-icon"><Icon name={categoryIcon(c.name)} size={16} /></span>
                      <span className="cat-row-name">{c.name}</span>
                      {c.id === chosen && <Icon name="check" size={16} />}
                    </button>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Change one transaction: its category and whether it's tagged #review. Saved in Actual. */
function TxEditor({ t, edit, onDone }: { t: MoneyTransaction; edit: Editing; onDone: () => void }) {
  const [splitting, setSplitting] = useState(false);
  const [pick, setPick] = useState(t.categoryId ?? '');
  const [review, setReview] = useState(!!t.review);
  const [note, setNote] = useState(t.note ?? '');
  const [asRule, setAsRule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Money going out (not money in, paid back or a transfer) can become a fixed expense: a bill, family budget only.
  const fixed = SHOW_BILLS && t.amount > 0 && !['income', 'owed', 'held', 'transfer'].includes(t.groupId) ? fixedFor(t, edit.data) : null;
  const [fixing, setFixing] = useState(false);
  const change = {
    ...(editable(t) && pick && pick !== t.categoryId ? { category: pick } : {}),
    ...(review !== !!t.review ? { review } : {}),
    ...(note.trim() !== (t.note ?? '') || (asRule && note.trim()) ? { note: note.trim() } : {}),
    ...(asRule && note.trim() ? { noteRule: true } : {}),
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
  if (splitting) return <SplitEditor t={t} data={edit.data} budget={edit.budget} onCancel={() => setSplitting(false)} onDone={() => { onDone(); edit.onChanged(); }} />;
  if (fixing && fixed) return <FixedForm initial={fixed.initial} onCancel={() => setFixing(false)} onSaved={() => { onDone(); edit.onChanged(); }} />;
  return (
    <div className="review-fix">
      {editable(t) ? (
        <CategoryPicker data={edit.data} value={pick} onChange={setPick} />
      ) : (
        <p className="muted small">A transfer: change it in Actual.</p>
      )}
      {t.splitOf && <p className="muted small">Part of a split.</p>}
      <input className="tx-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Description (optional)" maxLength={500} aria-label="Description" />
      <NoteRuleCheck t={t} note={note} checked={asRule} onChange={setAsRule} />
      <label className="check">
        <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Needs review (#review)
      </label>
      {fixed && (
        <button className="chip fix-bill" onClick={() => setFixing(true)}>
          <Icon name={fixed.existing ? 'edit' : 'repeat'} size={16} /> {fixed.existing ? 'Edit fixed expense' : 'Make it a fixed expense'}
        </button>
      )}
      {error && <p className="error small">{error}</p>}
      <div className="review-actions">
        {canSplit(t) && <button className="chip split-btn" onClick={() => setSplitting(true)} disabled={busy}>{t.splitOf ? 'Split this part' : 'Split'}</button>}
        <button className="chip" onClick={onDone} disabled={busy}>Cancel</button>
        <button className="primary" onClick={save} disabled={busy || !Object.keys(change).length}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

/** "Use it from now on": the description becomes part of the rule for this payee in Actual (not for transfers). */
function NoteRuleCheck({ t, note, checked, onChange }: { t: MoneyTransaction; note: string; checked: boolean; onChange: (v: boolean) => void }) {
  if (!note.trim() || !t.payee || t.groupId === 'transfer' || (!t.fixable && !t.splitOf)) return null;
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> Use this description for every {t.payee}
    </label>
  );
}

// A plain transaction or a part of a split (not a transfer) can be recategorised and split.
// A part of a split names the bank's line it comes from: "Split from CONTINENTE (€90.00) · ".
const splitLabel = (t: MoneyTransaction) =>
  t.splitOf && t.splitFrom ? `Split from ${t.splitFrom}${t.splitTotal ? ` (${eur(Math.abs(t.splitTotal), true)})` : ''} · ` : null;
const editable = (t: MoneyTransaction) => !!(t.fixable || t.splitOf);
const canSplit = (t: MoneyTransaction) => !!(t.id && editable(t) && t.amount);
const toCents = (s: string) => Math.round(Number(s.replace(',', '.').trim() || 'NaN') * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

/**
 * One payment, several things (groceries and a gift in one card payment): parts, each with its own amount, category
 * and description. The last part is always the rest. A part of a split can be split again: its new parts join the
 * same split (Actual has one level of splits). Saved as a split in Actual.
 */
function SplitEditor({ t, data, budget, onCancel, onDone }: { t: MoneyTransaction; data: MoneySummary; budget: MoneyBudget; onCancel: () => void; onDone: () => void }) {
  const total = Math.abs(t.amount);
  type Draft = { amount: string; cat: string; note: string };
  const [parts, setParts] = useState<Draft[]>([
    { amount: '', cat: t.categoryId ?? '', note: t.note ?? '' },
    { amount: '', cat: '', note: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = parts.slice(0, -1).map((p) => toCents(p.amount));
  const rest = total - typed.reduce((sum, c) => sum + (c > 0 ? c : 0), 0);
  const cents = [...typed, rest];
  const ready = cents.every((c) => c > 0) && parts.every((p) => p.cat);
  const set = (i: number, change: Partial<Draft>) => setParts(parts.map((p, j) => (j === i ? { ...p, ...change } : p)));
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.splitMoney(budget, t.id!, parts.map((p, i) => ({ amount: cents[i]!, category: p.cat, note: p.note.trim() })));
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const last = parts.length - 1;
  return (
    <div className="review-fix split">
      <p className="small">
        <b>{t.splitOf ? 'Split this part' : 'Split'} {eur(total, true)}</b> <span className="muted">· each part with its own category; the last one is the rest</span>
      </p>
      {parts.map((p, i) => (
        <fieldset key={i} className="split-part">
          <legend>
            Part {i + 1}
            {parts.length > 2 && i < last && (
              <button type="button" className="split-remove" onClick={() => setParts(parts.filter((_, j) => j !== i))} aria-label={`Remove part ${i + 1}`}>×</button>
            )}
          </legend>
          <label className="split-amount">
            <span>€</span>
            {i < last ? (
              <input inputMode="decimal" value={p.amount} onChange={(e) => set(i, { amount: e.target.value })} placeholder="0.00" aria-label={`Amount of part ${i + 1}`} />
            ) : (
              <output className={rest > 0 ? '' : 'error'} aria-label="The rest">{rest > 0 ? fromCents(rest) : rest === 0 ? '0.00' : `−${fromCents(-rest)}`}</output>
            )}
          </label>
          <CategoryPicker data={data} value={p.cat} onChange={(id) => set(i, { cat: id })} />
          <input className="tx-note" value={p.note} onChange={(e) => set(i, { note: e.target.value })} placeholder="Description (optional)" maxLength={500} aria-label={`Description of part ${i + 1}`} />
        </fieldset>
      ))}
      {parts.length < 10 && (
        <button type="button" className="chip split-add" onClick={() => setParts([...parts.slice(0, -1), { amount: '', cat: '', note: '' }, parts[last]!])}>
          <Icon name="plus" size={16} /> Add part
        </button>
      )}
      {rest <= 0 && typed.every((c) => c > 0) && <p className="error small">The parts add up to more than {eur(total, true)}: the last one needs something left.</p>}
      {error && <p className="error small">{error}</p>}
      <div className="review-actions">
        <button className="chip" onClick={onCancel} disabled={busy}>Back</button>
        <button className="primary" onClick={save} disabled={busy || !ready}>{busy ? 'Saving…' : `Split in ${parts.length}`}</button>
      </div>
    </div>
  );
}

/** Go through the #review transactions: fix the category or description (or keep them) and the tag comes out, in Actual. */
function ReviewSheet({ data, budget, onChanged, onClose }: { data: MoneySummary; budget: MoneyBudget; onChanged: () => void; onClose: () => void }) {
  const [splitting, setSplitting] = useState<string | null>(null); // id of the one being split
  const [openId, setOpenId] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const [asRule, setAsRule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]); // reviewed here, hidden before the page reloads
  const left = data.review.filter((t) => !done.includes(t.id!));

  function toggle(t: MoneyTransaction) {
    setError(null);
    setOpenId(openId === t.id ? null : t.id!);
    setPick(t.categoryId ?? '');
    setNote(t.note ?? '');
    setAsRule(false);
  }
  const changes = (t: MoneyTransaction) => ({
    ...(editable(t) && pick && pick !== t.categoryId ? { category: pick } : {}),
    ...(note.trim() !== (t.note ?? '') || (asRule && note.trim()) ? { note: note.trim() } : {}),
    ...(asRule && note.trim() ? { noteRule: true } : {}),
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
                {descOf(t) ?? (t.payee || '—')}
                <span className="sub">{splitLabel(t) ?? (descOf(t) && t.payee ? `${t.payee} · ` : '')}{shortDate(t.date)} · {t.account} · {t.category}</span>
              </span>
              <span className={`amt ${t.amount < 0 ? 'in' : ''}`}>{t.amount < 0 ? `+${eur(-t.amount, true)}` : eur(t.amount, true)}</span>
            </button>
            {openId === t.id && splitting === t.id && (
              <SplitEditor t={t} data={data} budget={budget} onCancel={() => setSplitting(null)} onDone={() => { setSplitting(null); setOpenId(null); onChanged(); }} />
            )}
            {openId === t.id && splitting !== t.id && (
              <div className="review-fix">
                {editable(t) ? (
                  <CategoryPicker data={data} value={pick} onChange={setPick} />
                ) : (
                  <p className="muted small">A split or a transfer: change its category in Actual.</p>
                )}
                <input className="tx-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Description (optional)" maxLength={500} aria-label="Description" />
                <NoteRuleCheck t={t} note={note} checked={asRule} onChange={setAsRule} />
                {error && <p className="error small">{error}</p>}
                <div className="review-actions">
                  {canSplit(t) && <button className="chip split-btn" disabled={busy} onClick={() => setSplitting(t.id!)}>{t.splitOf ? 'Split this part' : 'Split'}</button>}
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

/** −X in one account and +X in another, a few days apart: probably a transfer Actual didn't link. One tap links it. */
function TransfersCard({ data, budget, onChanged }: { data: MoneySummary; budget: MoneyBudget; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const left = data.transfers.filter((p) => !done.includes(p.key));
  if (!left.length) return null;
  async function act(p: MoneySummary['transfers'][number], action: 'link' | 'ignore') {
    setBusy(p.key);
    setError(null);
    try {
      await api.transferMoney(budget, p.out.id!, p.in.id!, action);
      setDone((d) => [...d, p.key]);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="card money-card transfers">
      <h2>Transfers between your accounts?</h2>
      <p className="muted small">The same money left one account and arrived in another. Linked, it's a transfer in Actual: not spending, not income.</p>
      <ul>
        {left.map((p) => (
          <li key={p.key}>
            <div className="transfer-row">
              <b>{eur(p.out.amount, true)}</b>
              <span className="transfer-path">{p.out.account} → {p.in.account}</span>
              <span className="muted small">{shortDate(p.out.date)}{p.in.date !== p.out.date ? ` / ${shortDate(p.in.date)}` : ''} · {p.out.payee || p.in.payee || '—'}</span>
            </div>
            <div className="review-actions">
              <button className="chip" disabled={!!busy} onClick={() => act(p, 'ignore')}>Not a transfer</button>
              <button className="primary" disabled={!!busy} onClick={() => act(p, 'link')}>{busy === p.key ? 'Linking…' : 'Link'}</button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="error small">{error}</p>}
    </section>
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
// For money in, the server puts the source's name (an income category, who paid, or "Sem categoria") in `category`.
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

function BalanceCard({ data, busy, onRefresh, onOwed, onHeld, onChanged }: { data: MoneySummary; busy: boolean; onRefresh: () => void; onOwed: () => void; onHeld: () => void; onChanged: () => void }) {
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
      {data.owed && data.owed.total !== 0 && (
        <button className="balance-owed" onClick={onOwed}>
          {data.owed.total > 0 ? `+ ${eur(data.owed.total)} to come back` : `${eur(-data.owed.total)} came back more than was paid`}
          <Icon name="right" size={14} />
        </button>
      )}
      {data.held && data.held.total !== 0 && (
        <button className="balance-owed" onClick={onHeld}>
          {data.held.total > 0 ? `− ${eur(data.held.total)} to hand over` : `${eur(-data.held.total)} handed over more than came in`}
          <Icon name="right" size={14} />
        </button>
      )}
      <button className="balance-toggle" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
        {showAll ? 'Hide accounts' : `${onBudget.length} account${onBudget.length === 1 ? '' : 's'}`}
        <Icon name={showAll ? 'up' : 'down'} size={16} />
      </button>
      {showAll && (
        <>
          <ul className="money-list">
            {onBudget.map((a) => (
              <AccountRow key={a.name} account={a} budget={data.budget} onChanged={onChanged} />
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

/** An account with its balance and IBAN: tap the IBAN to copy it; the pencil adds or changes it. */
function AccountRow({ account: a, budget, onChanged }: { account: MoneySummary['accounts'][number]; budget: MoneyBudget; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(a.iban ?? '');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function copy() {
    await navigator.clipboard?.writeText(a.iban!).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.saveIban(budget, a.name, value);
      setEditing(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="account-row">
      <span>
        {a.name}
        {!editing && (a.iban ? (
          <button className="iban" onClick={copy} aria-label={`Copy the IBAN of ${a.name}`}>
            <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : a.iban.replace(/(.{4})(?=.)/g, '$1 ')}
          </button>
        ) : (
          <button className="iban muted" onClick={() => setEditing(true)}>+ Add IBAN</button>
        ))}
      </span>
      <span className="account-side">
        <span className={`amt ${a.balance < 0 ? 'neg' : ''}`}>{eur(a.balance)}</span>
        {a.iban && !editing && <button className="iban-edit" aria-label={`Change the IBAN of ${a.name}`} onClick={() => setEditing(true)}><Icon name="edit" size={14} /></button>}
      </span>
      {editing && (
        <div className="iban-form">
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="PT50 0000 0000 0000 0000 0000 0" aria-label={`IBAN of ${a.name}`} autoCapitalize="characters" spellCheck={false} />
          {error && <p className="error small">{error}</p>}
          <div className="review-actions">
            <button className="chip" disabled={busy} onClick={() => { setEditing(false); setValue(a.iban ?? ''); setError(null); }}>Cancel</button>
            <button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    </li>
  );
}

const RANGES = [['1M', 1], ['3M', 3], ['6M', 6], ['1Y', 12]] as const;
const signed = (cents: number) => (cents > 0 ? `+${eur(cents)}` : cents < 0 ? eur(cents) : '±€0');
const compact = (cents: number) => {
  const v = cents / 100;
  return Math.abs(v) >= 1000 ? `€${(v / 1000).toFixed(Math.abs(v) >= 100_000 ? 0 : 1)}k` : `€${Math.round(v)}`;
};
const monthsBack = (date: string, n: number) => {
  const d = new Date(`${date}T12:00`);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Net worth (cash + savings & investments, debts left out) over time, with how it moved. */
function WorthCard({ worth }: { worth: MoneyWorth }) {
  const pts = worth.points;
  const total = (p: MoneyWorth['points'][number]) => p.cash + p.saved;
  const last = pts.at(-1)!;
  const at = (date: string) => pts.find((p) => p.date === date);
  const daysBack = (n: number) => pts[pts.length - 1 - n];
  const changes = [
    ['Yesterday', daysBack(1)],
    ['Week', daysBack(7)],
    ['Month', at(monthsBack(last.date, 1))],
    ['Year', at(monthsBack(last.date, 12))],
  ] as const;
  // This month so far, split into what moved it: cash or investments.
  const monthStart = [...pts].reverse().find((p) => p.date < `${last.date.slice(0, 7)}-01`);

  const available = RANGES.filter(([, n], i) => i === 0 || pts[0]!.date < monthsBack(last.date, RANGES[i - 1]![1]));
  const [range, setRange] = useState<number>(Math.min(3, available.at(-1)![1]));
  const from = monthsBack(last.date, range);
  const shown = pts.filter((p) => p.date >= from);
  const values = shown.map(total);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.16 || Math.max(Math.abs(hi) * 0.02, 100);
  const [min, max] = [lo - pad, hi + pad];
  const W = 300;
  const H = 100;
  const x = (i: number) => (shown.length > 1 ? (i / (shown.length - 1)) * W : W / 2);
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  const line = shown.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(total(p)).toFixed(1)}`).join('');
  const [hover, setHover] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const pick = (clientX: number) => {
    const r = plot.current!.getBoundingClientRect();
    setHover(Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (shown.length - 1)));
  };
  const h = hover !== null ? shown[hover] : null;

  return (
    <section className="card money-card worth">
      <div className="row">
        <h2>Net worth</h2>
        <div className="ranges" role="group" aria-label="Period">
          {available.map(([label, n]) => (
            <button key={label} className={range === n ? 'on' : ''} aria-pressed={range === n} onClick={() => { setRange(n); setHover(null); }}>{label}</button>
          ))}
        </div>
      </div>
      <div className="income-num">{eur(total(last))}</div>
      <p className="muted small worth-split">{eur(last.cash)} cash · {eur(last.saved)} savings &amp; investments</p>

      <div
        ref={plot}
        className="worth-plot"
        tabIndex={0}
        aria-label={`Net worth from ${shortDate(shown[0]!.date)} (${eur(values[0]!)}) to today (${eur(total(last))})`}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const step = e.key === 'ArrowLeft' ? -1 : 1;
            setHover((i) => Math.min(shown.length - 1, Math.max(0, (i ?? shown.length - 1) + step)));
          }
        }}
      >
        <span className="worth-y" style={{ top: `${y(hi)}%` }}>{compact(hi)}</span>
        <span className="worth-y below" style={{ top: `${y(lo)}%` }}>{compact(lo)}</span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" x2={W} y1={y(hi)} y2={y(hi)} className="grid" vectorEffect="non-scaling-stroke" />
          <line x1="0" x2={W} y1={y(lo)} y2={y(lo)} className="grid" vectorEffect="non-scaling-stroke" />
          <path d={line} className="worth-line" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* Dots and the crosshair are HTML so they stay round and thin however the chart is stretched. */}
        <span className="worth-dot" style={{ left: '100%', top: `${y(total(last))}%` }} />
        {h && (
          <>
            <span className="worth-cross" style={{ left: `${(x(hover!) / W) * 100}%` }} />
            <span className="worth-dot" style={{ left: `${(x(hover!) / W) * 100}%`, top: `${y(total(h))}%` }} />
            <div className={`worth-tip ${hover! > shown.length / 2 ? 'left' : ''}`} style={{ left: `${(x(hover!) / W) * 100}%` }}>
              <b>{eur(total(h))}</b>
              <span>{shortDate(h.date)}</span>
              <span>{signed(total(h) - total(last))} vs today</span>
            </div>
          </>
        )}
      </div>
      <div className="worth-x muted small"><span>{shortDate(shown[0]!.date)}</span><span>today</span></div>

      <ul className="worth-changes">
        {changes.map(([label, p]) => (
          <li key={label}>
            <span className="muted small">{label}</span>
            <b>{p ? signed(total(last) - total(p)) : '—'}</b>
          </li>
        ))}
      </ul>
      {monthStart && (
        <p className="muted small worth-note">
          This month {signed(total(last) - total(monthStart))}: cash {signed(last.cash - monthStart.cash)}, savings &amp; investments {signed(last.saved - monthStart.saved)}.
        </p>
      )}
      {worth.debtsLeftOut.length > 0 && <p className="muted small worth-note">{worth.debtsLeftOut.join(', ')} not counted.</p>}
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

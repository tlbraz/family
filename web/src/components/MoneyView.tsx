import { useCallback, useEffect, useRef, useState } from 'react';
import type { MoneyBudget, MoneyGroup, MoneyHolding, MoneyHoldings, MoneySummary, MoneyTransaction, MoneyWorth, PaperlessInbox } from '../../../shared/types';
import { api } from '../api';
import { BillsCard, BillsSheet } from './Bills';
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
  const [owedOpen, setOwedOpen] = useState(false);
  // The Paperless inbox (company documents to review); null when Paperless isn't set up or this isn't for us.
  const [inbox, setInbox] = useState<PaperlessInbox | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const hasCompany = !!data?.budgets.includes('company');
  const loadInbox = useCallback(() => {
    api.paperless().then((x) => { setInbox(x); setInboxError(null); }).catch((e: Error) => {
      if (!/not set up|Not available/.test(e.message)) setInboxError(e.message);
    });
  }, []);
  useEffect(() => {
    if (hasCompany) loadInbox();
  }, [hasCompany, loadInbox]);
  const [billsOpen, setBillsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.money(budget, month).then(setData).catch((e: Error) => setError(e.message));
  }, [budget, month]);
  useEffect(load, [load]);

  async function refresh() {
    setBusy(true);
    if (hasCompany) loadInbox();
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
              {b === 'company' && !!inbox?.count && <span className="switch-count" aria-label={`${inbox.count} documents to review`}>{inbox.count}</span>}
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
          <BalanceCard data={data} busy={busy} onRefresh={refresh} onOwed={() => setOwedOpen(true)} />
          {company && (inbox || inboxError) && <PaperlessCard inbox={inbox} error={inboxError} onOpen={() => setInboxOpen(true)} onRetry={loadInbox} />}
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
            <BillsCard data={data} onOpen={() => setBillsOpen(true)} />
            <ReviewCard review={data.review} onOpen={() => setReviewing(true)} />
            <TransfersCard data={data} budget={budget} onChanged={load} />
            <GroupsCard data={data} onOpen={setOpen} />
            <IncomeCard data={data} onOpen={setSource} />
          </div>
          {data.worth && <WorthCard worth={data.worth} />}
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
      {inboxOpen && inbox && <PaperlessSheet inbox={inbox} onClose={() => setInboxOpen(false)} />}
      {owedOpen && data?.owed && (
        <Sheet title={`To come back · ${eur(data.owed.total)}`} onClose={() => setOwedOpen(false)}>
          {data.owed.open.length > 0 ? (
            <>
              <h3 className="sheet-sub">Not paid back yet</h3>
              <TxList tx={data.owed.open} showCategory={false} />
            </>
          ) : (
            <p className="muted">Everything has come back ✓</p>
          )}
          <h3 className="sheet-sub">Latest</h3>
          <TxList tx={data.owed.recent} showCategory edit={{ data, budget, onChanged: load }} />
          <p className="muted small money-note">
            Paid for the company (or anyone else) and to come back: categories in the "A receber" group, or with "reembolso" in the name. They don't count as spending. Give the money back the same category, and the oldest expenses count as paid first.
          </p>
        </Sheet>
      )}
      {billsOpen && data?.bills && <BillsSheet data={data} onChanged={load} onClose={() => setBillsOpen(false)} />}
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
  const [room, setRoom] = useState(220);
  const box = useRef<HTMLDivElement>(null);
  // The phone keyboard covers the bottom of the screen: bring the field to the top and fit the list in what's left.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = box.current;
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
      const vv = window.visualViewport;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const input = el.querySelector('input')!.getBoundingClientRect();
      setRoom(Math.max(120, Math.min(260, bottom - input.bottom - 12)));
    };
    const timer = setTimeout(place, 300); // once the keyboard is up
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      clearTimeout(timer);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [open]);
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
    <div className="cat-picker" ref={box}>
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
        <ul role="listbox" aria-label="Categories" style={{ maxHeight: room }}>
          {matches.map((c) => (
            <li key={c.id} role="option" aria-selected={c.id === value} className={c.id === value ? 'on' : ''}
              onMouseDown={(e) => e.preventDefault()} onClick={() => choose(c.id)}>
              <b>{c.name}</b> <span>{c.group}</span>
            </li>
          ))}
          {!matches.length && <li className="none">No category matches "{query}"</li>}
        </ul>
      )}
      {/* Room to scroll the field up to the top while the list is open, even at the end of a sheet. */}
      {open && <div className="cat-spacer" aria-hidden="true" />}
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

/** How many documents wait in the Paperless inbox (to file, or to enter as an expense). */
function PaperlessCard({ inbox, error, onOpen, onRetry }: { inbox: PaperlessInbox | null; error: string | null; onOpen: () => void; onRetry: () => void }) {
  if (!inbox) {
    return (
      <section className="card money-card review done">
        <span className="error small">Paperless: {error}</span>
        <button className="chip" onClick={onRetry}>Try again</button>
      </section>
    );
  }
  if (!inbox.count) {
    return (
      <section className="card money-card review done">
        <Icon name="check" size={18} /> <span>Paperless inbox is empty</span>
      </section>
    );
  }
  return (
    <button className="card money-card review" onClick={onOpen}>
      <span className="review-count">{inbox.count}</span>
      <span className="review-text">
        <b>{inbox.count === 1 ? 'document' : 'documents'} in the Paperless inbox</b>
        <span className="muted small">newest {shortDate(inbox.documents[0]!.added.slice(0, 10))}</span>
      </span>
      <Icon name="right" />
    </button>
  );
}

/** The inbox documents with what Paperless knows about them, each a tap away from Paperless. */
function PaperlessSheet({ inbox, onClose }: { inbox: PaperlessInbox; onClose: () => void }) {
  return (
    <Sheet title={`Paperless inbox · ${inbox.count}`} onClose={onClose}>
      <ul className="paper-list">
        {inbox.documents.map((d) => (
          <li key={d.id} className="card doc paper">
            <a className="paper-thumb" href={d.url} target="_blank" rel="noreferrer" aria-label={`Open ${d.title} in Paperless`}>
              <img src={`/api/money/paperless/thumb/${d.id}`} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
            </a>
            <div className="paper-info">
              <b className="paper-title">{d.title}</b>
              <span className="muted small">
                {[d.correspondent, d.type].filter(Boolean).join(' · ') || 'No correspondent or type yet'}
              </span>
              <span className="muted small">
                {shortDate(d.created)}{d.pages ? ` · ${d.pages} page${d.pages === 1 ? '' : 's'}` : ''}{d.asn ? ` · ASN ${d.asn}` : ''} · added {shortDate(d.added.slice(0, 10))}
              </span>
              {(d.fields.length > 0 || d.tags.length > 0) && (
                <span className="paper-chips">
                  {d.fields.map((f) => <span key={f.name} className="paper-chip"><span className="muted">{f.name}</span> {f.value}</span>)}
                  {d.tags.map((t) => <span key={t} className="paper-chip tag">{t}</span>)}
                </span>
              )}
              {d.note && <span className="muted small paper-note">{d.note}</span>}
            </div>
            <a className="chip paper-open" href={d.url} target="_blank" rel="noreferrer">
              <Icon name="open" size={16} /> Open
            </a>
          </li>
        ))}
      </ul>
      {inbox.count > inbox.documents.length && <p className="muted small">Showing the newest {inbox.documents.length}.</p>}
      <p className="money-note small">
        <a href={inbox.url} target="_blank" rel="noreferrer">Open the inbox in Paperless</a>. A document leaves this list when the inbox tag comes off.
      </p>
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

function BalanceCard({ data, busy, onRefresh, onOwed }: { data: MoneySummary; busy: boolean; onRefresh: () => void; onOwed: () => void }) {
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

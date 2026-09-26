import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Member, Occurrence } from '../../../shared/types';
import { api } from '../api';
import { addDays, dateKey, dayLabel, fromKey, monthName, onDay, startOfWeek, timeOf, weekdayShort } from '../dates';
import { AvatarStack } from './Avatar';
import { Icon, TYPE_LABEL } from './Icon';

interface Props {
  members: Member[];
  refreshKey: number;
  onOpen: (o: Occurrence) => void;
  onAdd: (day: string) => void;
  canEdit: boolean;
}

type Mode = 'week' | 'month';
const MODE_KEY = 'family.calendarMode';

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'month' ? 'month' : 'week';
  } catch {
    return 'week';
  }
}

const isOff = (o: Occurrence) => o.kind === 'holiday' || (o.kind === 'school' && o.title.startsWith('No school'));
const isThing = (o: Occurrence) => o.kind === 'event' || o.kind === 'birthday';

export function CalendarView({ members, refreshKey, onOpen, onAdd, canEdit }: Props) {
  const [today, setToday] = useState(() => new Date());
  const [mode, setModeState] = useState<Mode>(readMode);
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => dateKey(new Date()));
  const [items, setItems] = useState<Occurrence[] | null>(null);
  const [who, setWho] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* private mode: fine */
    }
  };

  // Week: Monday–Sunday around the anchor. Month: whole weeks covering the anchor's month.
  const { from, days } = useMemo(() => {
    if (mode === 'week') {
      const s = startOfWeek(anchor);
      return { from: s, days: Array.from({ length: 7 }, (_, i) => addDays(s, i)) };
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const s = startOfWeek(first);
    const n = Math.round((addDays(startOfWeek(last), 7).getTime() - s.getTime()) / 86_400_000);
    return { from: s, days: Array.from({ length: n }, (_, i) => addDays(s, i)) };
  }, [mode, anchor]);
  const to = addDays(days[days.length - 1]!, 1);

  const load = useCallback(() => {
    api
      .calendar(dateKey(from), dateKey(to))
      .then((x) => {
        setItems(x);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey(from), dateKey(to)]);

  useEffect(load, [load, refreshKey]);
  useEffect(() => {
    // Keep "today" and the list fresh on a phone left open (and when it comes back to the foreground).
    const tick = () => {
      setToday(new Date());
      load();
    };
    const t = setInterval(tick, 5 * 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  const visible = (items ?? []).filter(
    (o) => who === null || o.kind === 'holiday' || o.kind === 'school' || o.participants.includes(who),
  );
  const todayKey = dateKey(today);
  const current =
    mode === 'week'
      ? dateKey(startOfWeek(today)) === dateKey(startOfWeek(anchor))
      : today.getFullYear() === anchor.getFullYear() && today.getMonth() === anchor.getMonth();

  function shift(n: number) {
    if (mode === 'week') setAnchor(addDays(anchor, 7 * n));
    else {
      const next = new Date(anchor.getFullYear(), anchor.getMonth() + n, 1);
      setAnchor(next);
      const sameMonth = today.getFullYear() === next.getFullYear() && today.getMonth() === next.getMonth();
      setSelected(dateKey(sameMonth ? today : next));
    }
  }
  // Swipe left/right on the calendar to move a week or a month. Ignored on the person chips
  // (they scroll sideways themselves) and when the gesture is mostly vertical (scrolling).
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const [slide, setSlide] = useState<'' | 'from-left' | 'from-right'>('');
  function onTouchStart(e: React.TouchEvent) {
    const target = e.target as HTMLElement;
    if (e.touches.length !== 1 || target.closest('.people')) return;
    touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY, t: Date.now() };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = e.changedTouches[0]!.clientX - start.x;
    const dy = e.changedTouches[0]!.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - start.t > 800) return;
    const dir = dx < 0 ? 1 : -1;
    shift(dir);
    setSlide(dir > 0 ? 'from-right' : 'from-left');
  }

  function goToday() {
    setAnchor(new Date());
    setSelected(todayKey);
  }

  let title: string;
  let eyebrow: string;
  if (mode === 'month') {
    title = monthName(anchor);
    eyebrow = current ? 'This month' : String(anchor.getFullYear());
  } else {
    const first = days[0]!;
    const last = days[6]!;
    title = first.getMonth() === last.getMonth() ? monthName(first) : `${monthName(first).slice(0, 3)} – ${monthName(last).slice(0, 3)}`;
    eyebrow = current ? 'This week' : `Week of ${first.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  }

  const dayProps = { visible, members, todayKey, today, canEdit, onOpen, onAdd };

  return (
    <div className="calendar" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="cal-head">
        <div className="cal-title">
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
        </div>
        <div className="cal-nav">
          <button className="round" aria-label={`Previous ${mode}`} onClick={() => shift(-1)}>
            <Icon name="left" />
          </button>
          <button className="round" aria-label={`Next ${mode}`} onClick={() => shift(1)}>
            <Icon name="right" />
          </button>
        </div>
      </header>

      <div className="view-row">
        <div className="segmented" role="group" aria-label="View">
          {(['week', 'month'] as const).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
        {!current && (
          <button className="chip" onClick={goToday}>
            Today
          </button>
        )}
      </div>

      <div className="people" role="group" aria-label="Show events for">
        <button className={`person-all ${who === null ? 'on' : ''}`} onClick={() => setWho(null)} aria-pressed={who === null}>
          Everyone
        </button>
        {members.map((m) => (
          <button
            key={m.id}
            className={`person ${who === m.id ? 'on' : ''}`}
            style={{ '--c': m.color } as React.CSSProperties}
            onClick={() => setWho(who === m.id ? null : m.id)}
            aria-pressed={who === m.id}
            title={m.name}
          >
            {m.name}
          </button>
        ))}
      </div>

      <div key={dateKey(from)} className={`slide ${slide}`} onAnimationEnd={() => setSlide('')}>
      {mode === 'week' && (
        <div className="week-strip">
          {days.map((d) => {
            const key = dateKey(d);
            const dots = visible.filter((o) => isThing(o) && onDay(o.start, o.end, key));
            const off = visible.some((o) => isOff(o) && onDay(o.start, o.end, key));
            return (
              <a key={key} href={`#d-${key}`} className={`day-pill ${key === todayKey ? 'today' : ''} ${off ? 'off' : ''}`}>
                <span className="dow">{weekdayShort(d)}</span>
                <span className="num">{d.getDate()}</span>
                <span className="dots">
                  {dots.slice(0, 4).map((o) => (
                    <span key={o.key} style={{ background: colorOf(o, members) }} />
                  ))}
                </span>
              </a>
            );
          })}
        </div>
      )}

      {mode === 'month' && (
        <MonthGrid days={days} month={anchor.getMonth()} visible={visible} members={members} todayKey={todayKey} selected={selected} onSelect={setSelected} />
      )}

      {error && <p className="error">{error}</p>}
      {!items && !error && <p className="muted pad">Loading…</p>}

      {items && mode === 'week' && (
        <div className="agenda">
          {days.map((d) => (
            <DayAgenda key={dateKey(d)} day={d} hidePastEmpty {...dayProps} />
          ))}
        </div>
      )}
      {items && mode === 'month' && (
        <div className="agenda">
          <DayAgenda day={fromKey(selected)} {...dayProps} />
        </div>
      )}
      </div>
    </div>
  );
}

const colorOf = (o: Occurrence, members: Member[]) => members.find((m) => m.id === o.participants[0])?.color ?? 'var(--muted)';

function MonthGrid({ days, month, visible, members, todayKey, selected, onSelect }: {
  days: Date[];
  month: number;
  visible: Occurrence[];
  members: Member[];
  todayKey: string;
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="month" role="grid" aria-label="Month">
      <div className="month-head" role="row">
        {days.slice(0, 7).map((d) => (
          <span key={d.getDay()} role="columnheader">{weekdayShort(d).slice(0, 2)}</span>
        ))}
      </div>
      <div className="month-body">
        {days.map((d) => {
          const key = dateKey(d);
          const here = visible.filter((o) => onDay(o.start, o.end, key));
          const things = here.filter(isThing);
          const off = here.find(isOff);
          const cls = ['cell', d.getMonth() !== month && 'other', key === todayKey && 'today', key === selected && 'selected', off && 'off'].filter(Boolean).join(' ');
          return (
            <button
              key={key}
              role="gridcell"
              className={cls}
              aria-selected={key === selected}
              aria-label={`${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}: ${things.length ? `${things.length} event${things.length > 1 ? 's' : ''}` : 'nothing planned'}${off ? `, ${off.title}` : ''}`}
              onClick={() => onSelect(key)}
            >
              <span className="cell-num">{d.getDate()}</span>
              <span className="cell-dots">
                {things.slice(0, 3).map((o) => (
                  <span key={o.key} style={{ background: colorOf(o, members) }} />
                ))}
                {things.length > 3 && <span className="more">+</span>}
              </span>
              <span className="cell-chips">
                {things.slice(0, 3).map((o) => (
                  <span key={o.key} className="cell-chip" style={{ '--c': colorOf(o, members) } as React.CSSProperties}>
                    {o.allDay ? '' : `${timeOf(o.start)} `}
                    {o.title}
                  </span>
                ))}
                {things.length > 3 && <span className="cell-more">+{things.length - 3} more</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayAgenda({ day, visible, members, todayKey, today, canEdit, onOpen, onAdd, hidePastEmpty }: {
  day: Date;
  visible: Occurrence[];
  members: Member[];
  todayKey: string;
  today: Date;
  canEdit: boolean;
  onOpen: (o: Occurrence) => void;
  onAdd: (day: string) => void;
  hidePastEmpty?: boolean;
}) {
  const key = dateKey(day);
  const dayItems = visible.filter((o) => onDay(o.start, o.end, key));
  const banners = dayItems.filter((o) => o.kind === 'holiday' || o.kind === 'school');
  const things = dayItems.filter(isThing);
  const past = key < todayKey;
  if (hidePastEmpty && past && things.length === 0 && banners.length === 0) return null; // skip empty days already gone
  return (
    <section id={`d-${key}`} className={`day ${past && hidePastEmpty ? 'past' : ''}`}>
      <div className="day-head">
        <h2>{dayLabel(day, today)}{day.getMonth() !== today.getMonth() || day.getFullYear() !== today.getFullYear() ? ` ${monthName(day)}` : ''}</h2>
        {canEdit && (
          <button className="add-mini" aria-label={`Add event on ${day.toDateString()}`} onClick={() => onAdd(key)}>
            <Icon name="plus" size={16} />
          </button>
        )}
      </div>
      {banners.map((b) => (
        <div key={b.key} className={`banner ${b.kind}`}>
          <Icon name={b.kind === 'holiday' ? 'holiday' : 'school'} size={15} />
          {b.title}
        </div>
      ))}
      {things.length === 0 && banners.length === 0 && <p className="nothing">Nothing planned</p>}
      {things.map((o) => (
        <EventCard key={o.key} o={o} members={members} dayKey={key} onOpen={() => onOpen(o)} />
      ))}
    </section>
  );
}

function EventCard({ o, members, dayKey, onOpen }: { o: Occurrence; members: Member[]; dayKey: string; onOpen: () => void }) {
  const lead = members.find((m) => m.id === o.participants[0]);
  const multiDay = dateKey(new Date(o.start)) !== dateKey(new Date(new Date(o.end).getTime() - 1));
  const startsToday = dateKey(new Date(o.start)) === dayKey;
  const time = o.allDay ? 'All day' : startsToday ? timeOf(o.start) : 'cont.';
  const todo = o.bring.filter((b) => !b.done);
  return (
    <div className="row">
      <div className="time">{time}</div>
      <button className={`card event ${o.kind}`} style={{ '--c': lead?.color ?? 'var(--muted)' } as React.CSSProperties} onClick={onOpen}>
        <span className="card-top">
          <span className="card-title">{o.title}</span>
          <AvatarStack ids={o.participants} members={members} />
        </span>
        <span className="meta">
          <span className="meta-item">
            <Icon name={o.type} size={14} />
            {TYPE_LABEL[o.type]}
          </span>
          {!o.allDay && startsToday && <span>until {multiDay ? new Date(o.end).toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' : ''}{timeOf(o.end)}</span>}
          {o.location && (
            <span className="meta-item">
              <Icon name="pin" size={14} />
              {o.location}
            </span>
          )}
          {o.repeats && o.kind === 'event' && <Icon name="repeat" size={14} />}
        </span>
        {todo.length > 0 && (
          <span className="bring-line">
            <Icon name="bag" size={14} />
            Bring: {todo.map((b) => b.text).join(' · ')}
          </span>
        )}
      </button>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Member, Occurrence } from '../../../shared/types';
import { api } from '../api';
import { addDays, dateKey, dayLabel, monthName, onDay, startOfWeek, timeOf, weekdayShort } from '../dates';
import { AvatarStack } from './Avatar';
import { Icon, TYPE_LABEL } from './Icon';

interface Props {
  members: Member[];
  refreshKey: number;
  onOpen: (o: Occurrence) => void;
  onAdd: (day: string) => void;
  canEdit: boolean;
}

export function CalendarView({ members, refreshKey, onOpen, onAdd, canEdit }: Props) {
  const [today, setToday] = useState(() => new Date());
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [items, setItems] = useState<Occurrence[] | null>(null);
  const [who, setWho] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const load = useCallback(() => {
    api
      .calendar(dateKey(weekStart), dateKey(addDays(weekStart, 7)))
      .then((x) => {
        setItems(x);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [weekStart]);

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
    (o) => who === null || o.kind === 'holiday' || o.kind === 'school' || o.participants.includes(who) || o.driverId === who,
  );
  const todayKey = dateKey(today);
  const thisWeek = dateKey(startOfWeek(today)) === dateKey(weekStart);
  const lastDay = days[6]!;
  const title = weekStart.getMonth() === lastDay.getMonth() ? monthName(weekStart) : `${monthName(weekStart).slice(0, 3)} – ${monthName(lastDay).slice(0, 3)}`;

  return (
    <div className="calendar">
      <header className="cal-head">
        <div className="cal-title">
          <span className="eyebrow">{thisWeek ? 'This week' : `Week of ${weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}</span>
          <h1>{title}</h1>
        </div>
        <div className="cal-nav">
          {!thisWeek && (
            <button className="chip" onClick={() => setWeekStart(startOfWeek(new Date()))}>
              Today
            </button>
          )}
          <button className="round" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <Icon name="left" />
          </button>
          <button className="round" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <Icon name="right" />
          </button>
        </div>
      </header>

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

      <div className="week-strip">
        {days.map((d) => {
          const key = dateKey(d);
          const dots = visible.filter((o) => (o.kind === 'event' || o.kind === 'birthday') && onDay(o.start, o.end, key));
          const off = visible.some((o) => (o.kind === 'holiday' || (o.kind === 'school' && o.title.startsWith('No school'))) && onDay(o.start, o.end, key));
          return (
            <a key={key} href={`#d-${key}`} className={`day-pill ${key === todayKey ? 'today' : ''} ${off ? 'off' : ''}`}>
              <span className="dow">{weekdayShort(d)}</span>
              <span className="num">{d.getDate()}</span>
              <span className="dots">
                {dots.slice(0, 4).map((o) => (
                  <span key={o.key} style={{ background: members.find((m) => m.id === o.participants[0])?.color ?? 'var(--muted)' }} />
                ))}
              </span>
            </a>
          );
        })}
      </div>

      {error && <p className="error">{error}</p>}
      {!items && !error && <p className="muted pad">Loading…</p>}

      {items && (
        <div className="agenda">
          {days.map((d) => {
            const key = dateKey(d);
            const dayItems = visible.filter((o) => onDay(o.start, o.end, key));
            const banners = dayItems.filter((o) => o.kind === 'holiday' || o.kind === 'school');
            const things = dayItems.filter((o) => o.kind === 'event' || o.kind === 'birthday');
            const past = key < todayKey;
            if (past && things.length === 0 && banners.length === 0) return null; // skip empty days already gone
            return (
              <section key={key} id={`d-${key}`} className={`day ${past ? 'past' : ''}`}>
                <div className="day-head">
                  <h2>{dayLabel(d, today)}</h2>
                  {canEdit && (
                    <button className="add-mini" aria-label={`Add event on ${d.toDateString()}`} onClick={() => onAdd(key)}>
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
          })}
        </div>
      )}
    </div>
  );
}

function EventCard({ o, members, dayKey, onOpen }: { o: Occurrence; members: Member[]; dayKey: string; onOpen: () => void }) {
  const lead = members.find((m) => m.id === o.participants[0]);
  const multiDay = dateKey(new Date(o.start)) !== dateKey(new Date(new Date(o.end).getTime() - 1));
  const startsToday = dateKey(new Date(o.start)) === dayKey;
  const time = o.allDay ? 'All day' : startsToday ? timeOf(o.start) : 'cont.';
  const todo = o.bring.filter((b) => !b.done);
  const driver = members.find((m) => m.id === o.driverId);
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
          {driver && (
            <span className="meta-item">
              <Icon name="car" size={14} />
              {driver.name}
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

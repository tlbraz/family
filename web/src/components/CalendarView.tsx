import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Member, Occurrence, Task } from '../../../shared/types';
import { api } from '../api';
import { addDays, dateKey, dayLabel, fromKey, monthName, onDay, startOfWeek, timeOf, weekdayShort } from '../dates';
import { Avatar, AvatarStack } from './Avatar';
import { Icon, TYPE_LABEL } from './Icon';
import { SearchView } from './SearchView';

interface Props {
  members: Member[];
  refreshKey: number;
  onOpen: (o: Occurrence) => void;
  onOpenTask: (t: Task) => void;
  onAdd: (day: string) => void;
  canEdit: boolean;
}

type Mode = 'week' | 'month';
const MODE_KEY = 'family.calendarMode';
const TASKS_KEY = 'family.showTasks';

function readShowTasks(): boolean {
  try {
    return localStorage.getItem(TASKS_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * The to-dos listed on day `key`: on their due day, except that open ones past their day move to
 * today. Ticked ones stay (crossed out) until the end of the day they were ticked, then drop off.
 */
function tasksOn(tasks: Task[], key: string, todayKey: string): Task[] {
  if (key < todayKey) return [];
  return tasks.filter((t) => {
    if (t.done && (!t.doneAt || dateKey(new Date(t.doneAt)) !== todayKey)) return false;
    return key === todayKey ? t.due <= key : t.due === key;
  });
}

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'month' ? 'month' : 'week';
  } catch {
    return 'week';
  }
}

const isOff = (o: Occurrence) => o.kind === 'holiday' || (o.kind === 'school' && o.title.startsWith('No school'));
const isThing = (o: Occurrence) => o.kind === 'event' || o.kind === 'birthday';

export function CalendarView({ members, refreshKey, onOpen, onOpenTask, onAdd, canEdit }: Props) {
  const [today, setToday] = useState(() => new Date());
  const [mode, setModeState] = useState<Mode>(readMode);
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => dateKey(new Date()));
  const [items, setItems] = useState<Occurrence[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [who, setWho] = useState<number | null>(null);
  const [showTasks, setShowTasksState] = useState(readShowTasks);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const setShowTasks = (on: boolean) => {
    setShowTasksState(on);
    try {
      localStorage.setItem(TASKS_KEY, on ? 'on' : 'off');
    } catch {
      /* private mode: fine */
    }
  };

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
    Promise.all([api.calendar(dateKey(from), dateKey(to)), api.tasks(dateKey(from), dateKey(to))])
      .then(([x, t]) => {
        setItems(x);
        setTasks(t);
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
  const myTasks = tasks.filter((t) => who === null || t.memberId === null || t.memberId === who);
  const visibleTasks = showTasks ? myTasks : [];
  const hiddenTasks = showTasks ? 0 : myTasks.filter((t) => !t.done && t.due <= todayKey).length; // due today or late
  const toggleTask = (t: Task) => {
    setTasks((list) => list.map((x) => (x.id === t.id ? { ...x, done: !x.done, doneAt: x.done ? null : new Date().toISOString() } : x)));
    api.toggleTask(t.id).catch((e: Error) => {
      setError(e.message);
      load();
    });
  };
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

  const dayProps = { visible, tasks: visibleTasks, hiddenTasks, onShowTasks: () => setShowTasks(true), members, todayKey, today, canEdit, onOpen, onOpenTask, onToggleTask: toggleTask, onAdd };

  if (searching) return <SearchView members={members} refreshKey={refreshKey} onOpen={onOpen} onClose={() => setSearching(false)} />;

  return (
    <div className="calendar" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="cal-head">
        <div className="cal-title">
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
        </div>
        <div className="cal-nav">
          <button className="round" aria-label="Search events" onClick={() => setSearching(true)}>
            <Icon name="search" />
          </button>
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
        <button className={`tasks-toggle ${showTasks ? 'on' : ''}`} onClick={() => setShowTasks(!showTasks)} aria-pressed={showTasks} title={showTasks ? 'Hide to-dos' : 'Show to-dos'}>
          <span className="box">{showTasks && <Icon name="check" size={12} stroke={3.5} />}</span>
          To-dos
        </button>
      </div>

      <div className={`people ${who !== null ? 'filtered' : ''}`} role="group" aria-label="Show events for">
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
            aria-label={m.name}
            title={m.name}
          >
            <Avatar member={m} size={36} />
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
            const due = tasksOn(visibleTasks, key, todayKey).some((t) => !t.done);
            return (
              <a key={key} href={`#d-${key}`} className={`day-pill ${key === todayKey ? 'today' : ''} ${off ? 'off' : ''}`}>
                <span className="dow">{weekdayShort(d)}</span>
                <span className="num">{d.getDate()}</span>
                <span className="dots">
                  {dots.slice(0, due ? 3 : 4).map((o) => (
                    <span key={o.key} style={{ background: colorOf(o, members) }} />
                  ))}
                  {due && <span className="task-dot" />}
                </span>
              </a>
            );
          })}
        </div>
      )}

      {mode === 'month' && (
        <MonthGrid days={days} month={anchor.getMonth()} visible={visible} tasks={visibleTasks} members={members} todayKey={todayKey} selected={selected} onSelect={setSelected} />
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

function MonthGrid({ days, month, visible, tasks, members, todayKey, selected, onSelect }: {
  days: Date[];
  month: number;
  visible: Occurrence[];
  tasks: Task[];
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
          const due = tasksOn(tasks, key, todayKey).filter((t) => !t.done);
          const cls = ['cell', d.getMonth() !== month && 'other', key === todayKey && 'today', key === selected && 'selected', off && 'off'].filter(Boolean).join(' ');
          return (
            <button
              key={key}
              role="gridcell"
              className={cls}
              aria-selected={key === selected}
              aria-label={`${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}: ${things.length ? `${things.length} event${things.length > 1 ? 's' : ''}` : 'nothing planned'}${due.length ? `, ${due.length} to-do${due.length > 1 ? 's' : ''}` : ''}${off ? `, ${off.title}` : ''}`}
              onClick={() => onSelect(key)}
            >
              <span className="cell-num">{d.getDate()}</span>
              <span className="cell-dots">
                {things.slice(0, 3).map((o) => (
                  <span key={o.key} style={{ background: colorOf(o, members) }} />
                ))}
                {things.length > 3 && <span className="more">+</span>}
                {due.length > 0 && <span className="task-dot" />}
              </span>
              <span className="cell-chips">
                {things.slice(0, 3).map((o) => (
                  <span key={o.key} className="cell-chip" style={{ '--c': colorOf(o, members) } as React.CSSProperties}>
                    {o.allDay ? '' : `${timeOf(o.start)} `}
                    {o.title}
                  </span>
                ))}
                {things.length > 3 && <span className="cell-more">+{things.length - 3} more</span>}
                {due.map((t) => (
                  <span key={t.id} className="cell-chip task">☐ {t.title}</span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayAgenda({ day, visible, tasks, hiddenTasks, onShowTasks, members, todayKey, today, canEdit, onOpen, onOpenTask, onToggleTask, onAdd, hidePastEmpty }: {
  day: Date;
  visible: Occurrence[];
  tasks: Task[];
  hiddenTasks: number;
  onShowTasks: () => void;
  onOpenTask: (t: Task) => void;
  onToggleTask: (t: Task) => void;
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
  const due = tasksOn(tasks, key, todayKey);
  const hidden = key === todayKey ? hiddenTasks : 0;
  const past = key < todayKey;
  if (hidePastEmpty && past && things.length === 0 && banners.length === 0 && due.length === 0) return null; // skip empty days already gone
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
      {things.length === 0 && banners.length === 0 && due.length === 0 && <p className="nothing">Nothing planned</p>}
      {hidden > 0 && (
        <button className="tasks-hidden" onClick={onShowTasks}>
          <Icon name="check" size={14} stroke={2.5} />
          {hidden} to-do{hidden > 1 ? 's' : ''} hidden · show
        </button>
      )}
      {due.map((t) => (
        <TaskRow key={t.id} t={t} members={members} dayKey={key} canEdit={canEdit} onOpen={() => onOpenTask(t)} onToggle={() => onToggleTask(t)} />
      ))}
      {things.map((o) => (
        <EventCard key={o.key} o={o} members={members} dayKey={key} onOpen={() => onOpen(o)} />
      ))}
    </section>
  );
}

/** One event in a list; `label` replaces the time column (search results show the date there). */
export function EventCard({ o, members, dayKey, onOpen, label }: { o: Occurrence; members: Member[]; dayKey: string; onOpen: () => void; label?: string }) {
  const lead = members.find((m) => m.id === o.participants[0]);
  const multiDay = dateKey(new Date(o.start)) !== dateKey(new Date(new Date(o.end).getTime() - 1));
  const startsToday = dateKey(new Date(o.start)) === dayKey;
  const time = o.allDay ? 'All day' : startsToday ? timeOf(o.start) : 'cont.';
  const todo = o.bring.filter((b) => !b.done);
  return (
    <div className="row">
      <div className="time">{label ?? time}</div>
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

function TaskRow({ t, members, dayKey, canEdit, onOpen, onToggle }: { t: Task; members: Member[]; dayKey: string; canEdit: boolean; onOpen: () => void; onToggle: () => void }) {
  const member = members.find((m) => m.id === t.memberId);
  const late = t.due < dayKey;
  return (
    <div className="row">
      <div className="time">{late ? 'Late' : 'Due'}</div>
      <div className={`card task-card ${t.done ? 'done' : ''} ${late ? 'late' : ''}`} style={{ '--c': member?.color ?? 'var(--muted)' } as React.CSSProperties}>
        <button className="tick" role="checkbox" aria-checked={t.done} aria-label={`${t.title}: ${t.done ? 'done' : 'not done'}`} onClick={onToggle}>
          {t.done && <Icon name="check" size={16} stroke={3} />}
        </button>
        <button className="task-text" onClick={onOpen} disabled={!canEdit}>
          <span className="card-title">{t.title}</span>
          {late && <span className="meta">Was due {fromKey(t.due).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' })}</span>}
        </button>
        {member && <Avatar member={member} size={26} />}
      </div>
    </div>
  );
}

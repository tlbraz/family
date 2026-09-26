import { useEffect, useRef, useState } from 'react';
import type { Member, Occurrence, SearchResults } from '../../../shared/types';
import { api } from '../api';
import { useBack } from '../back';
import { dateKey } from '../dates';
import { EventCard } from './CalendarView';
import { Icon } from './Icon';

interface Props {
  members: Member[];
  refreshKey: number;
  onOpen: (o: Occurrence) => void;
  onClose: () => void;
}

const QUERY_KEY = 'family.search';

function readQuery(): string {
  try {
    return sessionStorage.getItem(QUERY_KEY) ?? '';
  } catch {
    return '';
  }
}

/** "Sat 3 Oct", plus the year when it isn't this one. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: sameYear ? undefined : '2-digit' });
}

/** Find events by title, place, notes or who is going. */
export function SearchView({ members, refreshKey, onOpen, onClose }: Props) {
  const [q, setQ] = useState(readQuery);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useBack(onClose);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    const text = q.trim();
    try {
      sessionStorage.setItem(QUERY_KEY, q);
    } catch {
      /* private mode: fine */
    }
    if (text.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    let live = true;
    setLoading(true);
    // Wait for a pause in typing before asking the server.
    const t = setTimeout(() => {
      api
        .search(text)
        .then((r) => {
          if (!live) return;
          setResults(r);
          setError(null);
        })
        .catch((e: Error) => live && setError(e.message))
        .finally(() => live && setLoading(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, refreshKey]);

  const list = (items: Occurrence[]) =>
    items.map((o) => (
      <EventCard key={o.key} o={o} members={members} dayKey={dateKey(new Date(o.start))} label={shortDate(o.start)} onOpen={() => onOpen(o)} />
    ));
  const none = results && !results.upcoming.length && !results.past.length;

  return (
    <div className="search">
      <header className="cal-head">
        <div className="cal-title">
          <span className="eyebrow">Calendar</span>
          <h1>Search</h1>
        </div>
        <div className="cal-nav">
          <button className="round" aria-label="Back to calendar" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </header>

      <label className="search-box">
        <Icon name="search" />
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (q ? setQ('') : onClose())}
          placeholder="Dentist, football, a name…"
          aria-label="Search events"
          enterKeyHint="search"
          autoComplete="off"
        />
        {loading && <span className="spinner" aria-label="Searching" />}
      </label>

      {error && <p className="error">{error}</p>}
      {!results && !error && <p className="muted pad">Search by title, place, notes or who is going.</p>}
      {none && <p className="muted pad">Nothing found for “{q.trim()}”.</p>}

      {results && (
        <div className="agenda">
          {results.upcoming.length > 0 && (
            <section className="day">
              <div className="day-head"><h2>Coming up</h2></div>
              {list(results.upcoming)}
            </section>
          )}
          {results.past.length > 0 && (
            <section className="day past">
              <div className="day-head"><h2>Earlier</h2></div>
              {list(results.past)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

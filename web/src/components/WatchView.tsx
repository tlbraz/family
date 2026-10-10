import { useCallback, useEffect, useRef, useState } from 'react';
import type { WatchCard, WatchDetail, WatchFile, WatchGenre, WatchHealth, WatchKind, WatchList, WatchListItem, WatchSection, WatchSession, WatchStatus } from '../../../shared/types';
import { api } from '../api';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import './Watch.css';

// The Entertainment tab: what's out digitally (TMDB), getting it (Radarr / Sonarr) and watching it (Jellyfin on the TV).
// Parents only. Keys stay on the server; posters come straight from TMDB.

const shortDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const longDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const SECTIONS: [WatchSection, string][] = [['out', 'Out now'], ['soon', 'Coming soon'], ['popular', 'Popular']];
type Open = { kind: WatchKind; id: number };

export function WatchView() {
  const [mode, setMode] = useState<'releases' | 'list'>('releases');
  const [kind, setKind] = useState<WatchKind>('movie');
  const [open, setOpen] = useState<Open | null>(null);
  const [changed, setChanged] = useState(0); // something was added or deleted: refresh the badges
  const health = useWatchHealth();
  const [healthOpen, setHealthOpen] = useState(false);
  const [text, setText] = useState('');
  const query = useDebounced(text.trim(), 350);
  const searching = mode === 'releases' && query.length >= 2;

  return (
    <div className="watch">
      <header className="cal-head">
        <div className="cal-title">
          <span className="eyebrow">Only parents see this</span>
          <h1>Entertainment</h1>
        </div>
        <HealthDot health={health} expanded={healthOpen} onToggle={() => setHealthOpen(!healthOpen)} />
      </header>

      <HealthLine health={health} expanded={healthOpen} onToggle={() => setHealthOpen(!healthOpen)} />

      <div className="watch-bar">
        <div className="segmented" role="group" aria-label="Show">
          <button className={mode === 'releases' ? 'on' : ''} aria-pressed={mode === 'releases'} onClick={() => setMode('releases')}>Releases</button>
          <button className={mode === 'list' ? 'on' : ''} aria-pressed={mode === 'list'} onClick={() => setMode('list')}>My list</button>
        </div>
        {mode === 'releases' && !searching && (
          <div className="segmented" role="group" aria-label="Films or TV">
            <button className={kind === 'movie' ? 'on' : ''} aria-pressed={kind === 'movie'} onClick={() => setKind('movie')} aria-label="Films"><Icon name="film" size={16} /> Films</button>
            <button className={kind === 'tv' ? 'on' : ''} aria-pressed={kind === 'tv'} onClick={() => setKind('tv')} aria-label="TV"><Icon name="tv" size={16} /> TV</button>
          </div>
        )}
      </div>

      {mode === 'releases' && (
        <div className="docs-search watch-search">
          <Icon name="search" size={18} />
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search films and series…" aria-label="Search films and series" />
        </div>
      )}

      {mode === 'list' ? (
        <MyList changed={changed} onOpen={setOpen} />
      ) : searching ? (
        <SearchResults query={query} changed={changed} onOpen={setOpen} />
      ) : (
        <Releases kind={kind} changed={changed} onOpen={setOpen} />
      )}

      {open && <TitleSheet {...open} onClose={() => setOpen(null)} onChanged={() => setChanged((n) => n + 1)} />}
    </div>
  );
}

/**
 * Only when something is wrong (TMDB key missing, Radarr down, a disk filling up…); tap for the whole list.
 * When all is well, a small green dot in the header says so when tapped.
 */
function useWatchHealth() {
  const [health, setHealth] = useState<WatchHealth | null>(null);
  useEffect(() => {
    api.watchHealth().then(setHealth).catch(() => setHealth(null));
  }, []);
  return health;
}

/** The value once it has stopped changing for a moment (typing in the search box). */
function useDebounced<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

function HealthDot({ health, expanded, onToggle }: { health: WatchHealth | null; expanded: boolean; onToggle: () => void }) {
  if (!health || health.problems.length) return null;
  return <button className="watch-ok" onClick={onToggle} aria-expanded={expanded} aria-label="Status" title="Status"><span className="watch-dot" /></button>;
}

function HealthLine({ health, expanded, onToggle }: { health: WatchHealth | null; expanded: boolean; onToggle: () => void }) {
  if (!health) return null;
  if (!health.problems.length) return expanded ? <p className="watch-health-ok small">All good: {health.ok.join(', ')} answer.</p> : null;
  const [first, ...more] = health.problems;
  return (
    <button className="watch-health small" onClick={onToggle} aria-expanded={expanded}>
      <Icon name="warning" size={16} />
      {expanded ? (
        <span className="watch-problems">
          {health.problems.map((p) => <span key={p}>{p}</span>)}
          {health.ok.length > 0 && <span className="watch-fine">Fine: {health.ok.join(', ')}</span>}
        </span>
      ) : (
        <span>{first}{more.length ? ` · +${more.length} more` : ''}</span>
      )}
    </button>
  );
}

const BADGE: Record<WatchStatus['state'], string | null> = { library: 'In library', downloading: 'Downloading', wanted: 'Wanted', none: null };

function Badge({ status }: { status: WatchStatus | null }) {
  if (!status || status.state === 'none') return null;
  const text = status.state === 'downloading' && status.progress !== undefined ? `${Math.round(status.progress * 100)} %` : BADGE[status.state];
  return <span className={`watch-badge ${status.state}`}>{text}</span>;
}

/** One poster in a grid (releases and search). */
function PosterCard({ t, showKind = false, onOpen }: { t: WatchCard; showKind?: boolean; onOpen: (o: Open) => void }) {
  return (
    <button className="watch-card" onClick={() => onOpen({ kind: t.kind, id: t.id })}>
      <span className="watch-poster">
        {t.poster ? <img src={t.poster} alt="" loading="lazy" /> : <Icon name={t.kind === 'movie' ? 'film' : 'tv'} size={28} />}
        <Badge status={t.status} />
      </span>
      <b className="watch-title">{t.title}</b>
      <span className="muted small watch-meta">
        {[showKind ? (t.kind === 'movie' ? 'Film' : 'Series') : null, t.year, t.rating ? `★ ${t.rating.toFixed(1)}` : null].filter(Boolean).join(' · ')}
      </span>
      {t.date && <span className="small watch-date">{t.dateLabel ?? (t.kind === 'movie' ? 'Digital' : 'Aired')} {shortDate(t.date)}</span>}
    </button>
  );
}

/** Search results: films and series together, in TMDB's order, more as you scroll. */
function SearchResults({ query, changed, onOpen }: { query: string; changed: number; onOpen: (o: Open) => void }) {
  const [items, setItems] = useState<WatchCard[]>([]);
  const [page, setPage] = useState(1);
  const [next, setNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const asked = useRef(0); // ignore answers to an older search

  const load = useCallback(
    (pageNo: number) => {
      const ask = ++asked.current;
      setLoading(true);
      setError(null);
      api
        .watchSearch(query, pageNo)
        .then((p) => {
          if (ask !== asked.current) return;
          setItems((list) => (pageNo === 1 ? p.items : [...list, ...p.items.filter((x) => !list.some((y) => y.kind === x.kind && y.id === x.id))]));
          setNext(p.next);
          setPage(pageNo);
        })
        .catch((e: Error) => ask === asked.current && setError(e.message))
        .finally(() => ask === asked.current && setLoading(false));
    },
    [query],
  );
  useEffect(() => {
    setItems([]);
    load(1);
  }, [load, changed]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next || loading) return;
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load(page + 1), { rootMargin: '600px' });
    seen.observe(el);
    return () => seen.disconnect();
  }, [next, loading, page, load]);

  return (
    <>
      {error && (
        <section className="card watch-error">
          <p className="error">{error}</p>
          {error !== 'TMDB key missing' && <button className="chip" onClick={() => load(1)}>Try again</button>}
        </section>
      )}
      {!error && !loading && !items.length && <p className="muted watch-empty">Nothing found for “{query}”.</p>}
      <ul className="watch-grid">
        {items.map((t) => (
          <li key={`${t.kind}:${t.id}`}>
            <PosterCard t={t} showKind onOpen={onOpen} />
          </li>
        ))}
      </ul>
      <div ref={sentinel} />
      {loading && <p className="muted small watch-loading">{page === 1 && !items.length ? 'Searching…' : 'Loading more…'}</p>}
    </>
  );
}

/** The poster grid: out now / coming soon / popular, by genre, loading more as you scroll. */
function Releases({ kind, changed, onOpen }: { kind: WatchKind; changed: number; onOpen: (o: Open) => void }) {
  const [section, setSection] = useState<WatchSection>('out');
  const [genres, setGenres] = useState<WatchGenre[]>([]);
  const [genre, setGenre] = useState<number | undefined>();
  const [items, setItems] = useState<WatchCard[]>([]);
  const [page, setPage] = useState(1);
  const [next, setNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const asked = useRef(0); // ignore answers to an older list

  useEffect(() => {
    setGenre(undefined);
    api.watchGenres(kind).then(setGenres).catch(() => setGenres([]));
  }, [kind]);

  const load = useCallback(
    (pageNo: number) => {
      const ask = ++asked.current;
      setLoading(true);
      setError(null);
      api
        .releases(kind, section, pageNo, genre)
        .then((p) => {
          if (ask !== asked.current) return;
          setItems((list) => (pageNo === 1 ? p.items : [...list, ...p.items.filter((x) => !list.some((y) => y.id === x.id))]));
          setNext(p.next);
          setPage(pageNo);
        })
        .catch((e: Error) => ask === asked.current && setError(e.message))
        .finally(() => ask === asked.current && setLoading(false));
    },
    [kind, section, genre],
  );
  useEffect(() => {
    setItems([]);
    load(1);
  }, [load, changed]);

  // Infinite scroll: the next page when the end of the grid comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next || loading) return;
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load(page + 1), { rootMargin: '600px' });
    seen.observe(el);
    return () => seen.disconnect();
  }, [next, loading, page, load]);

  return (
    <>
      <div className="segmented watch-sections" role="group" aria-label="Which releases">
        {SECTIONS.map(([id, label]) => (
          <button key={id} className={section === id ? 'on' : ''} aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>
        ))}
      </div>
      {genres.length > 0 && (
        <div className="watch-genres" role="group" aria-label="Genre">
          <button className={`watch-genre${genre === undefined ? ' on' : ''}`} onClick={() => setGenre(undefined)}>All</button>
          {genres.map((g) => (
            <button key={g.id} className={`watch-genre${genre === g.id ? ' on' : ''}`} aria-pressed={genre === g.id} onClick={() => setGenre(genre === g.id ? undefined : g.id)}>{g.name}</button>
          ))}
        </div>
      )}

      {error && (
        <section className="card watch-error">
          <p className="error">{error}</p>
          {error !== 'TMDB key missing' && <button className="chip" onClick={() => load(1)}>Try again</button>}
        </section>
      )}
      {!error && !loading && !items.length && <p className="muted watch-empty">Nothing here{genre ? ' in this genre' : ''}.</p>}

      <ul className="watch-grid">
        {items.map((t) => (
          <li key={t.id}>
            <PosterCard t={t} onOpen={onOpen} />
          </li>
        ))}
      </ul>
      <div ref={sentinel} />
      {loading && <p className="muted small watch-loading">{page === 1 && !items.length ? 'Looking for releases…' : 'Loading more…'}</p>}
      <p className="muted small docs-foot">
        Releases from <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">TMDB</a>. Digital release dates (US).
      </p>
    </>
  );
}

/** Downloading, wanted and recently added. */
function MyList({ changed, onOpen }: { changed: number; onOpen: (o: Open) => void }) {
  const [list, setList] = useState<WatchList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.watchList().then((l) => { setList(l); setError(null); }).catch((e: Error) => setError(e.message)), []);
  useEffect(() => {
    void load();
  }, [load, changed]);
  // While something downloads, keep the progress moving.
  useEffect(() => {
    if (!list?.downloading.length) return;
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [list, load]);

  if (error) return <section className="card watch-error"><p className="error">{error}</p><button className="chip" onClick={() => void load()}>Try again</button></section>;
  if (!list) return <p className="muted watch-loading">Opening…</p>;
  const section = (title: string, rows: WatchListItem[], empty: string) => (
    <section className="watch-list-section">
      <h3>{title}</h3>
      {rows.length ? (
        <ul className="watch-rows">
          {rows.map((r, i) => (
            <li key={`${r.kind}:${r.id ?? r.title}:${i}`}>
              <button className="card watch-row" disabled={r.id === null} onClick={() => r.id !== null && onOpen({ kind: r.kind, id: r.id })}>
                <span className="watch-thumb">{r.poster ? <img src={r.poster} alt="" loading="lazy" /> : <Icon name={r.kind === 'movie' ? 'film' : 'tv'} size={20} />}</span>
                <span className="watch-row-text">
                  <b>{r.title}{r.year ? <span className="muted"> ({r.year})</span> : null}</b>
                  <span className="muted small">{r.sub}</span>
                  {r.progress !== undefined && <span className="watch-progress"><span style={{ width: `${Math.round(r.progress * 100)}%` }} /></span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{empty}</p>
      )}
    </section>
  );
  return (
    <>
      {section('Downloading', list.downloading, 'Nothing downloading.')}
      {section('Wanted', list.wanted, 'Nothing waiting to come out.')}
      {section('Recently added', list.recent, 'Nothing added lately.')}
    </>
  );
}

const runtimeText = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`);
type Monitor = 'all' | 'latestSeason' | 'future';
const MONITORS: [Monitor, string][] = [['all', 'Whole series'], ['latestSeason', 'Latest season'], ['future', 'Only new episodes']];

/** One title: trailer, details, where it stands, and Get it / Want it / Play / Delete. */
const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

/** Size, speed and what the file is: while downloading, and once it's in the library. */
function FileFacts({ state, file }: { state: WatchStatus['state']; file: WatchFile }) {
  if (state === 'downloading') {
    const done = file.left !== undefined && file.left < file.size ? file.size - file.left : null;
    return (
      <>
        <dt>Download</dt>
        <dd>{[done !== null ? `${gb(done)} of ${gb(file.size)}` : `${gb(file.size)} · waiting its turn`, file.speed ? `${gb(file.speed)}/s` : null].filter(Boolean).join(' · ')}</dd>
        {file.release && (
          <>
            <dt>Release</dt>
            <dd className="small watch-release">{file.release}</dd>
          </>
        )}
      </>
    );
  }
  return (
    <>
      <dt>File</dt>
      <dd>{[gb(file.size), file.episodes ? `${file.episodes} episode${file.episodes === 1 ? '' : 's'}` : null, file.mbps ? `${file.mbps} Mbps` : null].filter(Boolean).join(' · ')}</dd>
      {file.specs.length > 0 && (
        <>
          <dt>Specs</dt>
          <dd>{file.specs.join(' · ')}</dd>
        </>
      )}
    </>
  );
}

function TitleSheet({ kind, id, onClose, onChanged }: Open & { onClose: () => void; onChanged: () => void }) {
  const [t, setT] = useState<WatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [monitor, setMonitor] = useState<Monitor>('all');
  const [trailer, setTrailer] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [players, setPlayers] = useState<WatchSession[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    api.watchTitle(kind, id).then(setT).catch((e: Error) => setError(e.message));
  }, [kind, id]);

  async function act(run: () => Promise<WatchDetail>, done: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setT(await run());
      setNote(done);
      setConfirmDelete(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function play(session?: WatchSession) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      let target = session;
      if (!target) {
        const list = await api.players();
        if (list.length !== 1) {
          setPlayers(list);
          return;
        }
        target = list[0]!;
      }
      await api.playTitle(kind, id, target.id);
      setPlayers(null);
      setNote(`Playing on ${target.name}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const st = t?.status;
  const inArr = !!st?.arrId;
  return (
    <Sheet title={t?.title ?? 'Loading…'} onClose={onClose}>
      {error && !t && <p className="error">{error}</p>}
      {!t && !error && <p className="muted">Opening…</p>}
      {t && (
        <div className="watch-sheet">
          <div className="watch-hero">
            {t.backdrop && <img className="watch-backdrop" src={t.backdrop} alt="" />}
            {t.poster && <img className="watch-hero-poster" src={t.poster} alt="" />}
          </div>

          <p className="watch-facts">
            {[t.year, t.runtime ? runtimeText(t.runtime) : null, kind === 'tv' && t.seasons ? `${t.seasons} season${t.seasons === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
          </p>
          {t.genres.length > 0 && <span className="paper-chips">{t.genres.map((g) => <span key={g} className="paper-chip tag">{g}</span>)}</span>}

          <div className="watch-ratings">
            {t.rating !== null && <span className="watch-rating"><Icon name="star" size={14} /> <b>{t.rating.toFixed(1)}</b> <span className="muted small">TMDB · {t.votes.toLocaleString('en-GB')} votes</span></span>}
            {t.ratings.map((r) => <span key={r.source} className="watch-rating"><b>{r.value}</b> <span className="muted small">{r.source}</span></span>)}
            {!t.ratings.length && t.imdbUrl && <a className="watch-rating" href={t.imdbUrl} target="_blank" rel="noreferrer"><b>IMDb</b> <Icon name="open" size={14} /></a>}
          </div>

          <dl className="doc-meta">
            {kind === 'movie' ? (
              <>
                <dt>Digital</dt>
                <dd>{t.digital ? `${longDate(t.digital)}${t.digitalRegion && t.digitalRegion !== 'US' ? ` (${t.digitalRegion})` : ''}` : 'No date yet'}</dd>
              </>
            ) : t.airs ? (
              <>
                <dt>{t.airs.date > new Date().toISOString().slice(0, 10) ? 'Next' : 'Latest'}</dt>
                <dd>{t.airs.label} · {longDate(t.airs.date)}</dd>
              </>
            ) : null}
            {st && (
              <>
                <dt>Status</dt>
                <dd className={`watch-state ${st.state}`}>{st.state === 'downloading' ? st.text.split(' · ').filter((p) => !/\b(GB|MB)\b/.test(p)).join(' · ') : st.text}</dd>
              </>
            )}
            {st?.file && <FileFacts state={st.state} file={st.file} />}
          </dl>
          {st?.state === 'downloading' && st.progress !== undefined && <span className="watch-progress"><span style={{ width: `${Math.round(st.progress * 100)}%` }} /></span>}

          {/* Watch it */}
          {t.jellyfin && (
            <div className="watch-actions">
              <button className="primary" disabled={busy} onClick={() => void play()}><Icon name="play" size={18} /> Play on TV</button>
              <a className="chip" href={t.jellyfin.url} target="_blank" rel="noreferrer"><Icon name="open" size={16} /> Open in Jellyfin</a>
            </div>
          )}
          {players && players.length === 0 && <p className="watch-note small"><Icon name="tv" size={16} /> Open Jellyfin on the TV first, then tap Play again.</p>}
          {players && players.length > 1 && (
            <div className="watch-players">
              <span className="muted small">Play on…</span>
              {players.map((p) => <button key={p.id} className="chip" disabled={busy} onClick={() => void play(p)}>{p.name}</button>)}
            </div>
          )}

          {/* Get it / Want it */}
          {t.can.arr && st && st.state === 'none' && (
            <div className="watch-get">
              {kind === 'tv' && (
                <div className="segmented watch-monitor" role="group" aria-label="What to get">
                  {MONITORS.map(([m, label]) => <button key={m} className={monitor === m ? 'on' : ''} aria-pressed={monitor === m} onClick={() => setMonitor(m)}>{label}</button>)}
                </div>
              )}
              {t.released && !(kind === 'tv' && monitor === 'future') ? (
                <button className="primary wide" disabled={busy} onClick={() => void act(() => api.getTitle(kind, id, true, kind === 'tv' ? monitor : undefined), 'Added. Looking for it now.')}>
                  {busy ? 'Adding…' : 'Get it'}
                </button>
              ) : (
                <button className="primary wide" disabled={busy} onClick={() => void act(() => api.getTitle(kind, id, false, kind === 'tv' ? monitor : undefined), 'Added. It downloads by itself when it’s out.')}>
                  {busy ? 'Adding…' : 'Want it'}
                </button>
              )}
              <p className="muted small">
                {t.released && !(kind === 'tv' && monitor === 'future')
                  ? 'Adds it to the library and starts looking for a copy.'
                  : 'Not out yet: it downloads by itself when it comes out.'}
              </p>
            </div>
          )}
          {t.can.arr && st?.state === 'wanted' && t.released && (
            <div className="watch-actions">
              <button className="chip" disabled={busy} onClick={() => void act(() => api.getTitle(kind, id, true, kind === 'tv' ? 'all' : undefined), 'Looking for it now.')}>
                <Icon name="search" size={16} /> Search now
              </button>
            </div>
          )}
          {note && <p className="good-note small">{note}</p>}
          {error && <p className="error small">{error}</p>}

          {/* Trailer: only loaded when tapped */}
          {t.trailer && (
            <div className="watch-trailer">
              {trailer ? (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${t.trailer}?autoplay=1&rel=0&playsinline=1`}
                  title={`${t.title} trailer`}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              ) : (
                <button className="watch-trailer-cover" onClick={() => setTrailer(true)} aria-label="Play the trailer">
                  <img src={`https://i.ytimg.com/vi/${t.trailer}/hqdefault.jpg`} alt="" loading="lazy" />
                  <span className="watch-trailer-play"><Icon name="play" size={22} /> Trailer</span>
                </button>
              )}
            </div>
          )}

          {t.overview && <p className="watch-overview">{t.overview}</p>}

          {t.cast.length > 0 && (
            <>
              <h3 className="sheet-sub">Cast</h3>
              <ul className="watch-cast">
                {t.cast.map((c) => (
                  <li key={`${c.name}:${c.character}`}>
                    <span className="watch-face">{c.photo ? <img src={c.photo} alt="" loading="lazy" /> : c.name.slice(0, 1)}</span>
                    <b className="small">{c.name}</b>
                    {c.character && <span className="muted small">{c.character}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Delete */}
          {t.can.arr && inArr && (
            <div className="form-actions">
              {!confirmDelete ? (
                <button type="button" className="danger-link" onClick={() => setConfirmDelete(true)}>
                  <Icon name="trash" size={16} /> Delete from the library
                </button>
              ) : (
                <div className="watch-confirm">
                  <p className="small">Delete {t.title} and its files{kind === 'tv' ? ' (every episode)' : ''}? This can’t be undone.</p>
                  <div className="confirm">
                    <button type="button" className="chip danger" disabled={busy} onClick={() => void act(() => api.deleteTitle(kind, id), 'Deleted.')}>Yes, delete</button>
                    <button type="button" className="chip" onClick={() => setConfirmDelete(false)}>Keep</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

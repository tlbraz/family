import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { DocsMeta, DocsName, PaperlessDetail, PaperlessDoc } from '../../../shared/types';
import { api } from '../api';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

// The Docs tab: Paperless in the app. Search, look at and download documents, approve what's in the inbox, and
// send photos or PDFs from the phone. Parents only; everything goes through the server (the token stays there).

const shortDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
type Filters = { tag?: number; type?: number; correspondent?: number };

export function DocsView() {
  const [meta, setMeta] = useState<DocsMeta | null>(null);
  const [inboxCount, setInboxCount] = useState<number | null>(null);
  const [mode, setMode] = useState<'inbox' | 'all' | null>(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [docs, setDocs] = useState<PaperlessDoc[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [next, setNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadCount = useCallback(() => api.docs({ inbox: true }).then((p) => { setInboxCount(p.count); return p.count; }), []);

  // First: the lists for the filters, and how many wait in the inbox (start there when there are some).
  useEffect(() => {
    api.docsMeta().then(setMeta).catch((e: Error) => setError(e.message));
    loadCount().then((n) => setMode(n > 0 ? 'inbox' : 'all')).catch((e: Error) => { setError(e.message); setMode('all'); });
  }, [loadCount]);

  // Search as you type, once you pause.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);

  const load = useCallback(
    (pageNo: number) => {
      if (!mode) return;
      setLoading(true);
      setError(null);
      api
        .docs({ q: query || undefined, inbox: mode === 'inbox', page: pageNo, ...filters })
        .then((p) => {
          setDocs((d) => (pageNo === 1 ? p.documents : [...d, ...p.documents]));
          setCount(p.count);
          setNext(p.next);
          setPage(pageNo);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    },
    [mode, query, filters],
  );
  useEffect(() => load(1), [load]);

  const refresh = () => {
    load(1);
    void loadCount().catch(() => {});
  };

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setSent(null);
    try {
      const r = await api.uploadDocs([...files]);
      setSent(`Sent ${r.sent === 1 ? 'it' : `${r.sent} files`} to Paperless. ${r.sent === 1 ? 'It shows' : 'They show'} in the inbox once read, usually within a minute.`);
      // Paperless reads in the background: look again in a bit.
      setTimeout(refresh, 30_000);
      setTimeout(refresh, 90_000);
    } catch (e) {
      setSent((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const filtered = !!(filters.tag || filters.type || filters.correspondent);
  const nameIn = (list: DocsName[] | undefined, id?: number) => list?.find((x) => x.id === id)?.name;

  return (
    <div className="docs-view">
      <header className="cal-head">
        <div className="cal-title">
          <span className="eyebrow">Only parents see this</span>
          <h1>Docs</h1>
        </div>
        <label className={`chip docs-add ${uploading ? 'busy' : ''}`}>
          <Icon name="camera" size={18} /> {uploading ? 'Sending…' : 'Add'}
          <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple hidden disabled={uploading} onChange={(e) => void upload(e.target.files)} />
        </label>
      </header>
      {sent && <p className="docs-sent small" role="status">{sent}</p>}

      <div className="docs-search">
        <Icon name="search" size={18} />
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search words in the documents…" aria-label="Search documents" />
      </div>

      <div className="segmented docs-mode" role="group" aria-label="Show">
        <button className={mode === 'inbox' ? 'on' : ''} aria-pressed={mode === 'inbox'} onClick={() => setMode('inbox')}>
          <Icon name="inbox" size={16} /> Inbox{inboxCount ? <span className="switch-count">{inboxCount}</span> : null}
        </button>
        <button className={mode === 'all' ? 'on' : ''} aria-pressed={mode === 'all'} onClick={() => setMode('all')}>All</button>
      </div>

      {meta && (
        <div className="docs-filters">
          <select value={filters.type ?? ''} onChange={(e) => setFilters({ ...filters, type: Number(e.target.value) || undefined })} aria-label="Type" className={filters.type ? 'on' : ''}>
            <option value="">Any type</option>
            {meta.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={filters.correspondent ?? ''} onChange={(e) => setFilters({ ...filters, correspondent: Number(e.target.value) || undefined })} aria-label="From" className={filters.correspondent ? 'on' : ''}>
            <option value="">Anyone</option>
            {meta.correspondents.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={filters.tag ?? ''} onChange={(e) => setFilters({ ...filters, tag: Number(e.target.value) || undefined })} aria-label="Tag" className={filters.tag ? 'on' : ''}>
            <option value="">Any tag</option>
            {meta.tags.filter((t) => t.id !== meta.inboxTag).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {filtered && <button className="link small" onClick={() => setFilters({})}>Clear</button>}
        </div>
      )}

      {error && (
        <section className="card">
          <p className="error">{error}</p>
          <button className="chip" onClick={refresh}>Try again</button>
        </section>
      )}

      {mode && !error && (
        <p className="muted small docs-count">
          {loading && page === 1 && !docs.length
            ? 'Looking…'
            : mode === 'inbox' && !count && !query && !filtered
              ? 'Nothing to approve ✓'
              : `${count} document${count === 1 ? '' : 's'}${query ? ` matching "${query}"` : ''}${filters.type ? ` · ${nameIn(meta?.types, filters.type)}` : ''}${filters.correspondent ? ` · ${nameIn(meta?.correspondents, filters.correspondent)}` : ''}${filters.tag ? ` · #${nameIn(meta?.tags, filters.tag)}` : ''}${query ? ', best match first' : ', newest first'}`}
        </p>
      )}

      <ul className="docs-list">
        {docs.map((d) => (
          <li key={d.id}>
            <button className="card docs-row" onClick={() => setOpenId(d.id)}>
              <span className="docs-thumb"><img src={`/api/docs/${d.id}/thumb`} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} /></span>
              <span className="docs-info">
                <b>{d.title}</b>
                <span className="muted small">{[d.correspondent, d.type].filter(Boolean).join(' · ') || 'Not filed yet'}</span>
                <span className="muted small">{shortDate(d.created)}{d.inbox && mode !== 'inbox' ? ' · ' : ''}{d.inbox && mode !== 'inbox' && <span className="docs-inbox-tag">inbox</span>}</span>
                {d.snippet && (
                  <span className="docs-snippet small">
                    {d.snippet.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
                  </span>
                )}
                {(d.fields.length > 0 || d.tags.length > 0) && (
                  <span className="paper-chips">
                    {d.fields.map((f) => <span key={f.name} className="paper-chip"><span className="muted">{f.name}</span> {f.value}</span>)}
                    {d.tags.map((t) => <span key={t} className="paper-chip tag">{t}</span>)}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {next && (
        <button className="chip docs-more" disabled={loading} onClick={() => load(page + 1)}>{loading ? 'Loading…' : 'Show more'}</button>
      )}
      {meta && (
        <p className="muted small docs-foot">
          From <a href={meta.url} target="_blank" rel="noreferrer">Paperless</a>.
        </p>
      )}

      {openId !== null && meta && (
        <DocSheet
          id={openId}
          meta={meta}
          onClose={() => setOpenId(null)}
          onChanged={(approved) => {
            refresh();
            if (approved) setOpenId(null);
          }}
        />
      )}
    </div>
  );
}

/** One document: preview, view or download it, its details, and (in the inbox) put it right and approve. */
function DocSheet({ id, meta, onClose, onChanged }: { id: number; meta: DocsMeta; onClose: () => void; onChanged: (approved: boolean) => void }) {
  const [doc, setDoc] = useState<PaperlessDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    api.doc(id).then((d) => { setDoc(d); setEditing(d.inbox); }).catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <Sheet title={doc?.title ?? 'Document'} onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {!doc && !error && <p className="muted">Opening…</p>}
      {doc && (
        <div className="doc-sheet">
          <a className="doc-preview" href={`/api/docs/${doc.id}/preview`} target="_blank" rel="noreferrer" aria-label="View the document">
            <img src={`/api/docs/${doc.id}/thumb`} alt="" />
          </a>
          <div className="doc-actions">
            <a className="chip" href={`/api/docs/${doc.id}/preview`} target="_blank" rel="noreferrer"><Icon name="eye" size={16} /> View</a>
            <a className="chip" href={`/api/docs/${doc.id}/download`} download={doc.filename ?? undefined}><Icon name="download" size={16} /> Download</a>
            <a className="chip" href={doc.url} target="_blank" rel="noreferrer"><Icon name="open" size={16} /> Paperless</a>
          </div>

          {doc.inbox && <p className="doc-inbox-note small"><Icon name="inbox" size={16} /> In the inbox: check the details, then approve.</p>}

          {editing ? (
            <DocEditor doc={doc} meta={meta} onCancel={doc.inbox ? undefined : () => setEditing(false)} onSaved={(d, approved) => { setDoc(d); setEditing(d.inbox); onChanged(approved); }} />
          ) : (
            <>
              <dl className="doc-meta">
                <dt>From</dt><dd>{doc.correspondent ?? '—'}</dd>
                <dt>Type</dt><dd>{doc.type ?? '—'}</dd>
                <dt>Date</dt><dd>{shortDate(doc.created)}</dd>
                {doc.tags.length > 0 && <><dt>Tags</dt><dd>{doc.tags.join(', ')}</dd></>}
                {doc.fields.map((f) => <Fragment key={f.name}><dt>{f.name}</dt><dd>{f.value}</dd></Fragment>)}
              </dl>
              <button className="chip" onClick={() => setEditing(true)}><Icon name="edit" size={16} /> Edit details</button>
            </>
          )}

          <dl className="doc-meta quiet">
            <dt>Added</dt><dd>{shortDate(doc.added)}</dd>
            {doc.pages ? <><dt>Pages</dt><dd>{doc.pages}</dd></> : null}
            {doc.asn ? <><dt>ASN</dt><dd>{doc.asn}</dd></> : null}
            {doc.filename && <><dt>File</dt><dd className="doc-file">{doc.filename}</dd></>}
          </dl>
          {doc.notes.length > 0 && (
            <div className="doc-notes">
              <h3 className="sheet-sub">Notes</h3>
              {doc.notes.map((n, i) => <p key={i} className="small">{n.note} <span className="muted">· {shortDate(n.created)}</span></p>)}
            </div>
          )}
          {doc.content && (
            <details className="doc-text">
              <summary className="small">Text in the document</summary>
              <p className="small">{doc.content}{doc.content.length >= 3000 ? '…' : ''}</p>
            </details>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** Title, date, from, type and tags, with Paperless's suggestions one tap away. */
function DocEditor({ doc, meta, onCancel, onSaved }: { doc: PaperlessDetail; meta: DocsMeta; onCancel?: () => void; onSaved: (d: PaperlessDetail, approved: boolean) => void }) {
  const [title, setTitle] = useState(doc.title);
  const [created, setCreated] = useState(doc.created);
  const [correspondent, setCorrespondent] = useState<number | null>(doc.correspondentId);
  const [type, setType] = useState<number | null>(doc.typeId);
  const [tags, setTags] = useState<number[]>(doc.tagIds.filter((t) => t !== meta.inboxTag));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = doc.suggestions;

  async function save(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      // Keep the inbox tag unless approving (the server takes it off then).
      const keep = doc.inbox && !approve && meta.inboxTag ? [...tags, meta.inboxTag] : tags;
      onSaved(await api.saveDoc(doc.id, { title, created, correspondent, type, tags: keep, approve }), approve);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const suggest = (list: DocsName[], current: number | null, set: (id: number) => void) =>
    list.filter((x) => x.id !== current).length > 0 && (
      <span className="doc-suggest">
        {list.filter((x) => x.id !== current).map((x) => <button key={x.id} type="button" className="paper-chip sug" onClick={() => set(x.id)}>+ {x.name}</button>)}
      </span>
    );

  return (
    <form className="doc-edit" onSubmit={(e) => { e.preventDefault(); void save(doc.inbox); }}>
      <label>
        <span className="muted small">Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={128} required />
      </label>
      <label>
        <span className="muted small">Date of the document</span>
        <input type="date" value={created} onChange={(e) => setCreated(e.target.value)} required />
        {s.dates.filter((d) => d !== created).length > 0 && (
          <span className="doc-suggest">{s.dates.filter((d) => d !== created).map((d) => <button key={d} type="button" className="paper-chip sug" onClick={() => setCreated(d)}>{shortDate(d)}</button>)}</span>
        )}
      </label>
      <label>
        <span className="muted small">From</span>
        <select value={correspondent ?? ''} onChange={(e) => setCorrespondent(Number(e.target.value) || null)}>
          <option value="">—</option>
          {meta.correspondents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {suggest(s.correspondents, correspondent, setCorrespondent)}
      </label>
      <label>
        <span className="muted small">Type</span>
        <select value={type ?? ''} onChange={(e) => setType(Number(e.target.value) || null)}>
          <option value="">—</option>
          {meta.types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {suggest(s.types, type, setType)}
      </label>
      <div className="doc-tags">
        <span className="muted small">Tags</span>
        <span className="doc-suggest">
          {tags.map((t) => (
            <button key={t} type="button" className="paper-chip on" onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove ${meta.tags.find((x) => x.id === t)?.name}`}>
              {meta.tags.find((x) => x.id === t)?.name ?? t} ×
            </button>
          ))}
          {s.tags.filter((t) => !tags.includes(t.id)).map((t) => <button key={t.id} type="button" className="paper-chip sug" onClick={() => setTags([...tags, t.id])}>+ {t.name}</button>)}
        </span>
        <select value="" onChange={(e) => e.target.value && setTags([...tags, Number(e.target.value)])} aria-label="Add a tag">
          <option value="">Add a tag…</option>
          {meta.tags.filter((t) => t.id !== meta.inboxTag && !tags.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {error && <p className="error small">{error}</p>}
      <div className="review-actions">
        {onCancel && <button type="button" className="chip" disabled={busy} onClick={onCancel}>Cancel</button>}
        {doc.inbox ? (
          <>
            <button type="button" className="chip" disabled={busy} onClick={() => void save(false)}>Save</button>
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Approve ✓'}</button>
          </>
        ) : (
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        )}
      </div>
    </form>
  );
}

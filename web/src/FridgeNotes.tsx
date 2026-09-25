import { useEffect, useState, type FormEvent } from 'react';
import type { Note } from '../../shared/types';
import { api } from './api';

const AUTHOR_KEY = 'family.author';

function readAuthor() {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? '';
  } catch {
    return '';
  }
}

export function FridgeNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState('');
  const [author, setAuthor] = useState(readAuthor);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.notes().then(setNotes).catch((e: Error) => setError(e.message));
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      const note = await api.addNote(text, author);
      setNotes((n) => [note, ...n]);
      setText('');
      setError(null);
      try {
        localStorage.setItem(AUTHOR_KEY, author);
      } catch {
        /* private mode: fine */
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: number) {
    setNotes((n) => n.filter((x) => x.id !== id));
    await api.deleteNote(id).catch((e: Error) => setError(e.message));
  }

  return (
    <section className="card notes">
      <h2>📌 Fridge notes</h2>
      <form onSubmit={add} className="note-form">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Leave a note for everyone…"
          maxLength={280}
          aria-label="Note"
        />
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="Name"
          maxLength={40}
          className="author"
          aria-label="Your name"
        />
        <button type="submit" disabled={!text.trim()}>Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      {notes.length === 0 ? (
        <p className="empty">No notes yet.</p>
      ) : (
        <ul className="note-list">
          {notes.map((n) => (
            <li key={n.id}>
              <span className="note-text">{n.text}</span>
              <span className="note-meta">
                {n.author ? `${n.author} · ` : ''}
                {new Date(n.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </span>
              <button className="x" onClick={() => remove(n.id)} aria-label="Remove note">×</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

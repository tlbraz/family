import { useState, type FormEvent } from 'react';
import type { Task } from '../../../shared/types';
import { api } from '../api';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { VoiceButton } from './VoiceButton';

/** Event / To-do switch at the top of the "add" sheets. */
export function KindSwitch({ kind, onSwitch }: { kind: 'event' | 'task'; onSwitch: () => void }) {
  return (
    <div className="segmented kind-switch" role="group" aria-label="What to add">
      <button type="button" className={kind === 'event' ? 'on' : ''} aria-pressed={kind === 'event'} onClick={() => kind !== 'event' && onSwitch()}>Event</button>
      <button type="button" className={kind === 'task' ? 'on' : ''} aria-pressed={kind === 'task'} onClick={() => kind !== 'task' && onSwitch()}>To-do</button>
    </div>
  );
}

interface Props {
  task: Task | null; // null = new
  day: string;
  onClose: () => void;
  onSaved: () => void;
  onEvent?: () => void; // switch to adding an event instead
}

export function TaskSheet({ task, day, onClose, onSaved, onEvent }: Props) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [due, setDue] = useState(task?.due ?? day);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError('What needs doing?');
    setBusy(true);
    setError(null);
    try {
      // To-dos are for the whole family for now; an older one keeps whoever it was for.
      const input = { title: title.trim(), due, memberId: task?.memberId ?? null };
      if (task) await api.updateTask(task.id, input);
      else await api.addTask(input);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!task) return;
    setBusy(true);
    try {
      await api.deleteTask(task.id);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={task ? 'Edit to-do' : 'New to-do'} onClose={onClose}>
      <form className="event-form" onSubmit={save}>
        {onEvent && <KindSwitch kind="task" onSwitch={onEvent} />}

        <div className="title-row">
          <input id="task-title" className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sign the permission slip…" aria-label="What needs doing" maxLength={120} autoFocus={!task} />
          <VoiceButton onText={(t) => setTitle(t.slice(0, 120))} onDone={(t) => setTitle(t.slice(0, 120))} onError={setError} />
        </div>

        <fieldset>
          <legend>Due by</legend>
          <div className="when">
            <label>
              <span>Date</span>
              <input id="due" type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
            </label>
          </div>
        </fieldset>

        {error && <p className="error">{error}</p>}

        <div className="form-actions">
          {task && !confirmDelete && (
            <button type="button" className="danger-link" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={16} /> Delete
            </button>
          )}
          {confirmDelete && (
            <div className="confirm">
              <button type="button" className="chip danger" onClick={remove} disabled={busy}>Yes, delete</button>
              <button type="button" className="chip" onClick={() => setConfirmDelete(false)}>Keep</button>
            </div>
          )}
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : task ? 'Save' : 'Add to-do'}</button>
        </div>
      </form>
    </Sheet>
  );
}

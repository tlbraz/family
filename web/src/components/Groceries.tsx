import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { GroceryItem, GroceryList } from '../../../shared/types';
import { api } from '../api';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { VoiceButton } from './VoiceButton';
import './Groceries.css';

/** The family's grocery list, grouped by supermarket section; refreshes itself so two phones stay in step at the shop. */
export function Groceries() {
  const [list, setList] = useState<GroceryList | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<GroceryItem | null>(null);

  const run = useCallback((p: Promise<GroceryList>) => {
    p.then((l) => {
      setList(l);
      setError(null);
    }).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const load = () => document.visibilityState === 'visible' && run(api.groceries());
    load();
    const timer = setInterval(load, 15_000);
    document.addEventListener('visibilitychange', load);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [run]);

  function add(e?: FormEvent, spoken?: string) {
    e?.preventDefault();
    const t = (spoken ?? text).trim();
    if (!t) return;
    setText('');
    run(api.addGroceries(t));
  }

  function toggle(item: GroceryItem) {
    setList((l) => l && { ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) });
    run(api.toggleGrocery(item.id));
  }

  const open = list?.items.filter((i) => !i.done) ?? [];
  const done = list?.items.filter((i) => i.done) ?? [];

  return (
    <div className="groceries">
      <header className="cal-head">
        <div className="cal-title">
          <span className="eyebrow">{open.length ? `${open.length} to buy` : 'For the next shop'}</span>
          <h1>Groceries</h1>
        </div>
      </header>

      <form className="grocery-add" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Milk, bread and eggs…" aria-label="What to buy" enterKeyHint="done" />
        <VoiceButton onText={setText} onDone={(t) => add(undefined, t)} onError={setError} />
        <button type="submit" className="round dark" aria-label="Add" disabled={!text.trim()}>
          <Icon name="plus" />
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      {!!list?.suggestions.length && (
        <div className="grocery-again">
          <span className="eyebrow">Buy again</span>
          <div className="chips">
            {list.suggestions.map((s) => (
              <button key={s} className="chip" onClick={() => run(api.addGroceries(s))}>
                <Icon name="plus" size={14} /> {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {list && !list.items.length && <p className="empty">Nothing on the list. Add what you need, or say it.</p>}

      {list?.sections.map((section) => {
        const items = open.filter((i) => i.section === section);
        return items.length ? (
          <section key={section} className="grocery-section">
            <h3>{section}</h3>
            <ul>
              {items.map((i) => (
                <Row key={i.id} item={i} onToggle={() => toggle(i)} onMove={() => setMoving(i)} onRemove={() => run(api.deleteGrocery(i.id))} />
              ))}
            </ul>
          </section>
        ) : null;
      })}

      {done.length > 0 && (
        <section className="grocery-section in-cart">
          <h3>In the cart</h3>
          <ul>
            {done.map((i) => (
              <Row key={i.id} item={i} onToggle={() => toggle(i)} onMove={() => setMoving(i)} onRemove={() => run(api.deleteGrocery(i.id))} />
            ))}
          </ul>
          <button className="chip" onClick={() => run(api.clearGroceries())}>
            <Icon name="check" size={16} /> Done shopping: clear {done.length} ticked
          </button>
        </section>
      )}

      {moving && list && (
        <Sheet title={`Move "${moving.text}"`} onClose={() => setMoving(null)}>
          <div className="chips">
            {list.sections.map((s) => (
              <button
                key={s}
                className={`chip ${s === moving.section ? 'dark' : ''}`}
                onClick={() => {
                  run(api.moveGrocery(moving.id, s));
                  setMoving(null);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

// Tap to tick; hold to move it to another section.
function Row({ item, onToggle, onMove, onRemove }: { item: GroceryItem; onToggle: () => void; onMove: () => void; onRemove: () => void }) {
  const hold = useRef<number | null>(null);
  const held = useRef(false);
  const cancel = () => hold.current !== null && (clearTimeout(hold.current), (hold.current = null));
  return (
    <li className={`grocery-item ${item.done ? 'done' : ''}`}>
      <button
        className="grocery-tick"
        onPointerDown={() => {
          held.current = false;
          hold.current = window.setTimeout(() => {
            held.current = true;
            onMove();
          }, 550);
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => !held.current && onToggle()}
        aria-pressed={item.done}
      >
        <span className="box">{item.done && <Icon name="check" size={16} stroke={3} />}</span>
        <span className="grocery-text">{item.text}</span>
      </button>
      <button className="x" onClick={onRemove} aria-label={`Remove ${item.text}`}>×</button>
    </li>
  );
}

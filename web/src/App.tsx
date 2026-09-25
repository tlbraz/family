import { useEffect, useState } from 'react';
import type { Health } from '../../shared/types';
import { api } from './api';
import { FridgeNotes } from './FridgeNotes';

const COMING = [
  { icon: '📅', title: 'Calendar', text: 'Who is where, this week' },
  { icon: '✅', title: 'Chores', text: 'Jobs, turns and streaks' },
  { icon: '🛒', title: 'Shopping', text: 'One list, every phone' },
  { icon: '🍲', title: 'Meals', text: 'Plan the week, fill the list' },
];

function greeting(hour: number) {
  if (hour < 6) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 19) return 'Good afternoon';
  return 'Good evening';
}

export function App() {
  const [now, setNow] = useState(() => new Date());
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    api.health().then(setHealth).catch(() => setHealth(null));
    return () => clearInterval(t);
  }, []);

  return (
    <div className="page">
      <header className="hero">
        <p className="date">
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1>{greeting(now.getHours())}</h1>
      </header>

      <main className="grid">
        <FridgeNotes />
        {COMING.map((m) => (
          <section key={m.title} className="card soon">
            <span className="icon" aria-hidden>{m.icon}</span>
            <div>
              <h2>{m.title}</h2>
              <p>{m.text}</p>
            </div>
            <span className="badge">soon</span>
          </section>
        ))}
      </main>

      <footer className="footer">
        {health ? (
          <>
            v{health.version} · {health.commit} ·{' '}
            <span className={health.db === 'up' ? 'up' : 'down'}>db {health.db}</span>
          </>
        ) : (
          <span className="down">server unreachable</span>
        )}
      </footer>
    </div>
  );
}

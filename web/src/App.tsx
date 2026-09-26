import { useCallback, useEffect, useState } from 'react';
import type { AppConfig, Health, Member, Occurrence, Task } from '../../shared/types';
import { api } from './api';
import { useBack } from './back';
import { type Shared, takeShared } from './share';
import { dateKey } from './dates';
import { Avatar, setFamily } from './components/Avatar';
import { CalendarView } from './components/CalendarView';
import { EventSheet } from './components/EventSheet';
import { FamilyView } from './components/FamilyView';
import { FridgeNotes } from './components/FridgeNotes';
import { Icon } from './components/Icon';
import { SignIn } from './components/SignIn';
import { TaskSheet } from './components/TaskSheet';

type Tab = 'calendar' | 'notes' | 'family';
type Open = { kind: 'event'; occurrence: Occurrence | null; day: string; shared?: Shared; fromDay?: boolean } | { kind: 'task'; task: Task | null; day: string; fromDay?: boolean } | null;

export function App() {
  const [tab, setTab] = useState<Tab>('calendar');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [signIn, setSignIn] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [shared, setShared] = useState<Shared | null>(null);
  useBack(() => setTab('calendar'), tab !== 'calendar');

  const loadAll = useCallback(() => {
    api.config().then(setConfig).catch(() => setConfig({ me: null, features: { ai: false, google: false, telegram: false } }));
    api.members().then((list) => {
      setFamily(list);
      setMembers(list);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadAll();
    api.health().then(setHealth).catch(() => setHealth(null));
  }, [loadAll]);

  const me = config?.me ?? null;
  const canEdit = me?.role === 'parent';

  // Something shared from another app: open "New event" with it (after signing in, if needed).
  useEffect(() => {
    takeShared().then((s) => s && setShared(s));
  }, []);
  useEffect(() => {
    if (!shared || !config) return;
    if (!canEdit) return setSignIn(true);
    setTab('calendar');
    setOpen({ kind: 'event', occurrence: null, day: dateKey(new Date()), shared });
    setShared(null);
  }, [shared, config, canEdit]);

  return (
    <div className="shell">
      <div className="topbar">
        <span className="brand">
          <img src="/icon.svg" alt="" width={26} height={26} />
          Family
        </span>
        {me ? (
          <button className="me" onClick={() => api.logout().then(loadAll)} title="Sign out">
            <Avatar member={members.find((m) => m.id === me.id) ?? me} size={30} />
            <span className="small">Sign out</span>
          </button>
        ) : (
          <button className="chip" onClick={() => setSignIn(true)}>Sign in</button>
        )}
      </div>

      <main className="page">
        {tab === 'calendar' && (
          <CalendarView
            members={members}
            refreshKey={refresh}
            canEdit={canEdit}
            onOpen={(occurrence) => setOpen({ kind: 'event', occurrence, day: dateKey(new Date(occurrence.start)) })}
            onOpenTask={(task) => setOpen({ kind: 'task', task, day: task.due })}
            onAdd={(day) => setOpen({ kind: 'event', occurrence: null, day, fromDay: true })}
          />
        )}
        {tab === 'notes' && (
          <div>
            <header className="cal-head">
              <div className="cal-title">
                <span className="eyebrow">For everyone</span>
                <h1>Fridge notes</h1>
              </div>
            </header>
            <FridgeNotes />
          </div>
        )}
        {tab === 'family' && <FamilyView members={members} canEdit={canEdit} googleOn={!!config?.features.google} telegramOn={!!config?.features.telegram} onChanged={loadAll} />}

        <footer className="footer">
          {health ? (
            <>
              v{health.version} · {health.commit} · <span className={health.db === 'up' ? 'up' : 'down'}>db {health.db}</span>
            </>
          ) : (
            <span className="down">server unreachable</span>
          )}
        </footer>
      </main>

      {tab === 'calendar' && canEdit && (
        <div className="fabs">
          <button className="fab" onClick={() => setOpen({ kind: 'task', task: null, day: dateKey(new Date()) })}>
            <Icon name="plus" size={20} stroke={2.5} />
            To-do
          </button>
          <button className="fab" onClick={() => setOpen({ kind: 'event', occurrence: null, day: dateKey(new Date()) })}>
            <Icon name="plus" size={20} stroke={2.5} />
            Event
          </button>
        </div>
      )}

      <nav className="tabs" aria-label="Sections">
        {(
          [
            ['calendar', 'calendar', 'Calendar'],
            ['notes', 'notes', 'Notes'],
            ['family', 'people', 'Family'],
          ] as const
        ).map(([id, icon, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            <Icon name={icon} size={22} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {open?.kind === 'task' && (
        <TaskSheet
          task={open.task}
          day={open.day}
          onClose={() => setOpen(null)}
          onEvent={open.fromDay ? () => setOpen({ kind: 'event', occurrence: null, day: open.day, fromDay: true }) : undefined}
          onSaved={() => {
            setOpen(null);
            setRefresh((r) => r + 1);
          }}
        />
      )}
      {open?.kind === 'event' && (
        <EventSheet
          members={members}
          canEdit={canEdit}
          aiEnabled={!!config?.features.ai}
          occurrence={open.occurrence}
          day={open.day}
          shared={open.shared}
          onClose={() => setOpen(null)}
          onTodo={open.fromDay ? () => setOpen({ kind: 'task', task: null, day: open.day, fromDay: true }) : undefined}
          onSaved={() => {
            setOpen(null);
            setRefresh((r) => r + 1);
          }}
        />
      )}
      {signIn && (
        <SignIn
          members={members}
          onClose={() => {
            setSignIn(false);
            setShared(null);
          }}
          onDone={() => {
            setSignIn(false);
            loadAll();
            setRefresh((r) => r + 1);
          }}
        />
      )}
    </div>
  );
}

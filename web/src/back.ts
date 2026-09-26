import { useEffect, useRef } from 'react';

/*
 * Keeps the phone/browser back button inside the app. One guard history entry
 * always sits on top; pressing back pops it, we re-arm it and run the newest
 * registered handler (close the open sheet, return to the calendar tab, ...).
 * With nothing registered, back simply does nothing.
 */
const handlers: { current: () => void }[] = [];

export function installBackTrap() {
  const arm = () => history.pushState({ backTrap: true }, '');
  if (!history.state?.backTrap) arm();
  window.addEventListener('popstate', () => {
    arm();
    handlers.at(-1)?.current();
  });
}

/** While `enabled`, the back button calls `onBack` (newest registration wins). */
export function useBack(onBack: () => void, enabled = true) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!enabled) return;
    const h = { current: () => ref.current() };
    handlers.push(h);
    return () => {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    };
  }, [enabled]);
}

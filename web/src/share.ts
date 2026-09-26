// Things shared to the app (Share → Family on the phone). The service worker (public/sw.js)
// stashes them in a cache and opens /?share=1; we pick them up once and clean the URL.
export interface Shared {
  text: string;
  image?: File;
}

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

let taken: Promise<Shared | null> | null = null;

export function takeShared(): Promise<Shared | null> {
  taken ??= (async () => {
    if (!new URLSearchParams(location.search).has('share')) return null;
    history.replaceState(history.state, '', '/');
    if (!('caches' in window)) return null;
    const box = await caches.open('share');
    const [t, f] = await Promise.all([box.match('/shared/text'), box.match('/shared/file')]);
    await Promise.all([box.delete('/shared/text'), box.delete('/shared/file')]);
    const text = t ? (await t.text()).trim() : '';
    const blob = f ? await f.blob() : null;
    const image = blob?.type.startsWith('image/') ? new File([blob], 'shared', { type: blob.type }) : undefined;
    return text || image ? { text, image } : null;
  })();
  return taken;
}

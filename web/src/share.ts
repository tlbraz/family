// Things shared to the app (Share → Family on the phone). The server keeps them for a few
// minutes and opens /?share=<id>; we pick them up once and clean the URL.
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
    const id = new URLSearchParams(location.search).get('share');
    if (!id) return null;
    history.replaceState(history.state, '', '/');
    const res = await fetch(`/api/share/${encodeURIComponent(id)}`).catch(() => null);
    if (!res?.ok) return null;
    const body: { text: string; image: { mediaType: string; data: string } | null } = await res.json();
    const image = body.image
      ? new File([await (await fetch(`data:${body.image.mediaType};base64,${body.image.data}`)).blob()], 'shared', { type: body.image.mediaType })
      : undefined;
    return body.text || image ? { text: body.text, image } : null;
  })();
  return taken;
}

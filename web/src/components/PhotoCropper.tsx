import { useEffect, useRef, useState, type PointerEvent } from 'react';

const VIEW = 260; // on-screen crop square, px
const OUT = 256; // saved picture, px
const MAX_ZOOM = 5;

interface View {
  zoom: number; // 1 = the photo just covers the square
  x: number; // photo's top-left inside the square
  y: number;
}

/** Drag to move, pinch / slider to zoom; the round frame shows what the avatar will look like. */
export function PhotoCropper({ file, onDone, onCancel }: { file: File; onDone: (dataUrl: string) => void; onCancel: () => void }) {
  const [url] = useState(() => URL.createObjectURL(file));
  const img = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [failed, setFailed] = useState(false);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const base = size ? VIEW / Math.min(size.w, size.h) : 1;

  // Keep the photo covering the whole square.
  const clamp = (v: View): View => {
    if (!size) return v;
    const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
    const s = base * zoom;
    return {
      zoom,
      x: Math.min(0, Math.max(VIEW - size.w * s, v.x)),
      y: Math.min(0, Math.max(VIEW - size.h * s, v.y)),
    };
  };

  // Zoom keeping the point (px, py) of the square still.
  const zoomAt = (v: View, zoom: number, px = VIEW / 2, py = VIEW / 2): View => {
    const k = Math.min(MAX_ZOOM, Math.max(1, zoom)) / v.zoom;
    return clamp({ zoom: v.zoom * k, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
  };

  function loaded() {
    const el = img.current!;
    const s = { w: el.naturalWidth, h: el.naturalHeight };
    const b = VIEW / Math.min(s.w, s.h);
    setSize(s);
    setView({ zoom: 1, x: (VIEW - s.w * b) / 2, y: (VIEW - s.h * b) / 2 });
  }

  const local = (e: PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function down(e: PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
  }

  function move(e: PointerEvent) {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (!prev) return;
    const now = local(e);
    if (ps.size === 1) {
      setView((v) => clamp({ ...v, x: v.x + now.x - prev.x, y: v.y + now.y - prev.y }));
    } else if (ps.size === 2) {
      const other = [...ps.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(now.x - other.x, now.y - other.y);
      if (before > 0) setView((v) => zoomAt(v, (v.zoom * after) / before, (now.x + other.x) / 2, (now.y + other.y) / 2));
    }
    ps.set(e.pointerId, now);
  }

  const up = (e: PointerEvent) => pointers.current.delete(e.pointerId);

  function use() {
    const s = base * view.zoom;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = OUT;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.current!, -view.x / s, -view.y / s, VIEW / s, VIEW / s, 0, 0, OUT, OUT);
    onDone(canvas.toDataURL('image/jpeg', 0.85));
  }

  if (failed) {
    return (
      <div className="cropper">
        <p className="error">Couldn't read that picture.</p>
        <button type="button" className="chip" onClick={onCancel}>Back</button>
      </div>
    );
  }

  const s = base * view.zoom;
  return (
    <div className="cropper">
      <p className="muted small">Drag to move, pinch or slide to zoom.</p>
      <div
        className="crop-view"
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => setView((v) => zoomAt(v, v.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))}
      >
        <img
          ref={img}
          src={url}
          alt=""
          draggable={false}
          onLoad={loaded}
          onError={() => setFailed(true)}
          style={size ? { width: size.w * s, height: size.h * s, transform: `translate(${view.x}px, ${view.y}px)` } : { visibility: 'hidden' }}
        />
        <div className="crop-ring" />
      </div>
      <input
        type="range"
        className="crop-zoom"
        aria-label="Zoom"
        min={1}
        max={MAX_ZOOM}
        step={0.01}
        value={view.zoom}
        onChange={(e) => setView((v) => zoomAt(v, Number(e.target.value)))}
      />
      <div className="form-actions">
        <button type="button" className="chip" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={use} disabled={!size}>Use photo</button>
      </div>
    </div>
  );
}

// Stroke icons, 24×24, drawn in currentColor.
const PATHS: Record<string, string> = {
  medical: 'M3 12h4l2-5 4 10 2-5h6',
  sports: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7l4 3-1.5 5h-5L8 10z',
  school: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5',
  party: 'M4 9h16v11H4zM12 9v11M3 9h18M12 9c-1.5-3-5-3.5-5-1s5 1 5 1c0 0 5 1.5 5-1s-3.5-2-5 1',
  family: 'M4 11l8-7 8 7v9H4zM10 20v-5h4v5',
  work: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  holiday: 'M12 21V10M12 10c-4 0-7-2-8-5 3-1 6 0 8 5 2-5 5-6 8-5-1 3-4 5-8 5',
  other: 'M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 6.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  birthday: 'M5 21h14v-8H5zM5 16c2 1.5 4 1.5 7 0s5-1.5 7 0M12 13V9M12 3.5c1 1.2 1 2.5 0 3.5-1-1-1-2.3 0-3.5',
  plus: 'M12 5v14M5 12h14',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  repeat: 'M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4',
  pin: 'M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 6.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  bag: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  notes: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  people: 'M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 11a3 3 0 1 0 0-6M17.5 14.5c2 .6 3.5 2.6 3.5 5.5',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 11v6M12 7.5h.01',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M20 20l-4-4',
  cart: 'M3 4h2.5l2.2 10.5h10.6L20.5 7H6.4M10 19.5a1 1 0 1 0 0 .01M17 19.5a1 1 0 1 0 0 .01',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  money: 'M3 7h18v12H3zM3 11h18M7 15h3',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  inbox: 'M4 13l2.5-8h11L20 13v6H4zM4 13h5l1 2h4l1-2h5',
  eye: 'M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  docs: 'M7 3h8l4 4v14H7zM14 3v5h5M4 7v14h11',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  play: 'M7 4.5v15l12-7.5z',
  tv: 'M3 6h18v12H3zM8 21h8M12 18v3',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  warning: 'M12 3.5L2.5 20h19zM12 10v4.5M12 17.5h.01',
};

export function Icon({ name, size = 18, stroke = 2 }: { name: string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name] ?? PATHS.other} />
    </svg>
  );
}

export const TYPE_LABEL: Record<string, string> = {
  medical: 'Medical',
  sports: 'Sports',
  school: 'School',
  party: 'Party',
  family: 'Family',
  work: 'Work',
  holiday: 'Holiday',
  other: 'Other',
  birthday: 'Birthday',
};

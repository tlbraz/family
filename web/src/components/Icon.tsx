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
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  repeat: 'M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4',
  pin: 'M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 6.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  bag: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  notes: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  people: 'M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 11a3 3 0 1 0 0-6M17.5 14.5c2 .6 3.5 2.6 3.5 5.5',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 11v6M12 7.5h.01',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M20 20l-4-4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
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

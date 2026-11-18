/** One line-icon set for the app: 24px grid, 1.75 stroke, round caps. Drawn for the Hub. */
const P: Record<string, string> = {
  inbox: 'M3 13h5l1.5 3h5L16 13h5 M5 5h14l2 8v6H3v-6z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  flow: 'M3 7h12 M11 3l4 4-4 4 M21 17H9 M13 13l-4 4 4 4',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3.5 6h.01 M3.5 12h.01 M3.5 18h.01',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
  building: 'M4 21V5l8-3v19 M12 8h8v13 M4 21h18 M7.5 8h1 M7.5 12h1 M7.5 16h1 M15.5 12h1 M15.5 16h1',
  gate: 'M4 21V7l8-4 8 4v14 M9 21v-7h6v7',
  calendar: 'M4 6h16v15H4z M4 10h16 M8 3v5 M16 3v5',
  scale: 'M12 3v18 M5 21h14 M4 8h16 M4 8l-2.5 6a3 3 0 0 0 5 0z M20 8l-2.5 6a3 3 0 0 0 5 0z',
  exit: 'M14 4h6v16h-6 M10 8l-4 4 4 4 M6 12h10',
  trend: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
  cycle: 'M20 11a8 8 0 0 0-14.3-4.6L3 9 M3 4v5h5 M4 13a8 8 0 0 0 14.3 4.6L21 15 M21 20v-5h-5',
  coins: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5 M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  overlap: 'M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M15 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12z',
  handshake: 'M4 12h4l3-3 3 3h6 M4 12V7h5 M20 12V7h-5 M8 12l4 4 4-4',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21v-1a6 6 0 0 1 12 0v1 M16 3.5a4 4 0 0 1 0 7 M22 21v-1a6 6 0 0 0-4-5.6',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
  play: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M10 8.5v7l5.5-3.5z',
  edit: 'M4 20h4L19 9l-4-4L4 16z M14 6l4 4',
  file: 'M6 2h8l5 5v15H6z M14 2v5h5 M9 13h7 M9 17h7',
  pulse: 'M3 12h4l3-7 4 14 3-7h4',
  check: 'M4 12l5 5L20 6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
};
export const Icon = ({ n, size = 16 }: { n: keyof typeof P | string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={P[n] ?? P.grid} />
  </svg>
);

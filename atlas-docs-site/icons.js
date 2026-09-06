const PATHS = {
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
  command: '<path d="M18 8a3 3 0 1 0-6 0v8a3 3 0 1 0 6 0"></path><path d="M6 8a3 3 0 1 1 6 0v8a3 3 0 1 1-6 0"></path>',
  check: '<path d="m5 12 4 4L19 6"></path>',
  lock: '<rect x="4" y="10" width="16" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"></path>',
  list: '<path d="M8 6h13"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M3 6h.01"></path><path d="M3 12h.01"></path><path d="M3 18h.01"></path>',
  chart: '<path d="M3 3v18h18"></path><path d="m7 16 4-5 3 3 5-7"></path>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path>',
  case: '<path d="M4 5a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"></path><path d="M4 9h16"></path>',
  rotate: '<path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path>',
  note: '<path d="M4 4h16v14H8l-4 3Z"></path><path d="M8 9h8M8 13h5"></path>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"></path><path d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4V19a2 2 0 1 1-4 0v-.2A2 2 0 0 0 5.8 17l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A2 2 0 0 0 1.6 11H1.5a2 2 0 1 1 0-4h.2A2 2 0 0 0 3 3.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A2 2 0 0 0 9.2 0h.2a2 2 0 1 1 4 0v.2A2 2 0 0 0 16.8 1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A2 2 0 0 0 21 7h.2a2 2 0 1 1 0 4H21a2 2 0 0 0-1.6 4Z" transform="translate(1.5 1.5) scale(.83)"></path>',
  close: '<path d="m6 6 12 12M18 6 6 18"></path>',
  arrow: '<path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path>',
  chevron: '<path d="m6 9 6 6 6-6"></path>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path>',
  apple: '<path d="M16.5 12.5c0-2 1.6-3 1.7-3.1-.9-1.3-2.4-1.5-2.9-1.5-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.4 0-2.7.8-3.4 2-.1.2-1.1 2 .3 4.7.7 1.3 1.5 2.7 2.6 2.7 1 0 1.4-.7 2.6-.7 1.2 0 1.5.7 2.6.7 1.1 0 1.8-1.1 2.5-2.5.8-1.4 1.1-2.7 1.1-2.7s-1.4-.5-1.4-2.6ZM14.7 6.2c.5-.6.8-1.5.7-2.4-.8 0-1.7.5-2.2 1.1-.5.6-.8 1.4-.7 2.3.8.1 1.7-.4 2.2-1Z"></path>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5"></path><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"></path>',
  shield: '<path d="M12 22s8-3.8 8-10V5l-8-3-8 3v7c0 6.2 8 10 8 10Z"></path><path d="m9 12 2 2 4-4"></path>',
  target: '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="5"></circle><circle cx="12" cy="12" r="1"></circle>',
  help: '<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a2.5 2.5 0 1 1 4.4 1.6c-.8.9-1.9 1.3-1.9 2.7"></path><path d="M12 17h.01"></path>',
};

const SIZES = {
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
};

export function icon(name, size = 'md', label = '') {
  const body = PATHS[name] ?? PATHS.help;
  const pixels = SIZES[size] ?? size;
  const accessible = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg ${accessible} width="${pixels}" height="${pixels}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

// Простые линейные значки для стенда (временные: настоящий набор выберем в дизайн-системе).
const PATHS: Record<string, React.ReactNode> = {
  cut: (<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="1.6" /><path d="M12 4v3M12 17v3M4 12h3M17 12h3" /></>),
  grind: (<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5.5" /><circle cx="12" cy="12" r="1.5" /></>),
  drill: (<><path d="M9 3h6l-1 5h-4zM12 8v13" /><path d="M10 12l4 1.6M10 16l4 1.6" /></>),
  screw: (<><path d="M4 20l6-6" /><path d="M9.5 14.5L17 7l3 3-7.5 7.5z" /><path d="M17 7l1.5-3.5L22 2" /></>),
  saw: (<><path d="M3 15l3-6 3 6 3-6 3 6 3-6 3 6" /><path d="M3 19h18" /></>),
  measure: (<><rect x="3" y="8" width="18" height="8" rx="1" /><path d="M7 8v3M11 8v4.5M15 8v3M19 8v4.5" /></>),
  garden: (<><path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14z" /><path d="M5 19l8-8" /></>),
  weld: (<><path d="M11 3l1.6 5.4L18 10l-5.4 1.6L11 17l-1.6-5.4L4 10l5.4-1.6z" /><path d="M18 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" /></>),
  battery: (<><rect x="3" y="7" width="16" height="10" rx="2" /><path d="M21 10v4M7 10v4M11 10v4" /></>),
  phone: (<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" />),
  chat: (<path d="M4 5h16v11H9l-5 4z" />),
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l5 5" /></>),
  cart: (<><path d="M3 4h3l2.4 11h9.2L20 8H7" /><circle cx="9.5" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></>),
  menu: (<path d="M4 7h16M4 12h16M4 17h16" />),
  user: (<><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4.5 4-6 8-6s7 1.5 8 6" /></>),
  shield: (<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>),
  back: (<><path d="M4 12a8 8 0 108-8H7" /><path d="M9 1L6.5 4 9 7" /></>),
  truck: (<><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>),
  bolt: (<path d="M13 2L5 13h6l-1 9 8-11h-6z" />),
};

export function Icon({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name] ?? PATHS.cut}
    </svg>
  );
}

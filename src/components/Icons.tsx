import type { ReactNode } from "react";

/** A 24×24 line icon in the current text colour; decorative, so the button or text beside it names it. */
function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PenIcon = () => (
  <Icon>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    <path d="M14.5 5.5l3 3" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16" />
    <path d="M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M9 7V4h6v3" />
  </Icon>
);

export const ArchiveIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
    <path d="M10 13h4" />
  </Icon>
);

export const TrendUpIcon = () => (
  <Icon size={22}>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </Icon>
);

export const TrendDownIcon = () => (
  <Icon size={22}>
    <path d="M3 7l6 6 4-4 8 8" />
    <path d="M15 17h6v-6" />
  </Icon>
);

export const TrendFlatIcon = () => (
  <Icon size={22}>
    <path d="M3 12h18" />
    <path d="M17 8l4 4-4 4" />
  </Icon>
);

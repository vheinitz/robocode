// Einfarbige SVG-Icons für die Befehls-Buttons — bewusst ohne Emojis (die sind
// plattformabhängig und unflexibel) und ohne Textlabels (sparen Platz auf dem
// Handy). Was welches Symbol bedeutet, zeigt die Hilfe-Legende (Icon "help").
//
// Alle Pfade zeichnen in currentColor; so passt sich das Icon der Button-Farbe
// an (hell/aktiv/hover). viewBox durchgängig 0 0 24 24.

import type { JSX } from 'react'

const P: Record<string, JSX.Element> = {
  // Ablauf
  while: (
    <>
      <path d="M3 12a9 9 0 0 1 15-6.6L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.6L3 16" />
      <path d="M3 21v-5h5" />
    </>
  ),
  if: (
    <>
      <path d="M12 3l9 9-9 9-9-9z" />
    </>
  ),
  elif: (
    <>
      <path d="M12 3l9 9-9 9-9-9z" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  else: (
    <>
      <path d="M4 5v7a4 4 0 0 0 4 4h10" />
      <path d="M14 12l4 4-4 4" />
    </>
  ),
  def: (
    <>
      <path d="M9 4H7.5A3 3 0 0 0 4.5 7 2 2 0 0 1 2.5 9 2 2 0 0 1 4.5 11 3 3 0 0 0 7.5 14H9" />
      <path d="M15 4h1.5A3 3 0 0 1 19.5 7 2 2 0 0 0 21.5 9 2 2 0 0 0 19.5 11 3 3 0 0 1 16.5 14H15" />
    </>
  ),
  wait: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  every: (
    <>
      <circle cx="12" cy="13.5" r="7.2" />
      <path d="M12 9.5v4l2.5 1.5" />
      <path d="M9.5 3h5M12 3v3.3" />
    </>
  ),
  toggle: (
    <>
      <rect x="2.5" y="8" width="19" height="8" rx="4" />
      <circle cx="16" cy="12" r="2.6" />
    </>
  ),
  color: (
    <>
      <path d="M12 3s6.2 6.6 6.2 10.6A6.2 6.2 0 0 1 5.8 13.6C5.8 9.6 12 3 12 3z" />
    </>
  ),
  gt: (
    <>
      <path d="M9 6l6 6-6 6" />
    </>
  ),
  for: (
    <>
      <path d="M4 7h7" />
      <path d="M4 12h5" />
      <path d="M4 17h7" />
      <path d="M15 5l5 7-5 7" />
    </>
  ),
  log: (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <path d="M6 9l3 2.5L6 14" />
      <path d="M11.5 14.5H17" />
    </>
  ),
  // Ports
  do: (
    <>
      <circle cx="6.5" cy="12" r="2.6" />
      <path d="M9.1 12H20" />
      <path d="M16 8l4 4-4 4" />
    </>
  ),
  di: (
    <>
      <path d="M3 12h10.5" />
      <path d="M10 8l4 4-4 4" />
      <circle cx="19" cy="12" r="2.6" />
    </>
  ),
  a: (
    <>
      <path d="M2.5 12c2.3-6 4.2-6 5.7 0s3.4 6 5 0 3.4-6 5.3 0" />
    </>
  ),
  chip: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="1.6" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </>
  ),
  // Werkzeuge
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 3.8" />
      <circle cx="12" cy="17.2" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
  undo: (
    <>
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H8" />
      <path d="M8 5L4 9l4 4" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v5h7V3" />
      <rect x="8" y="13" width="8" height="5" rx="0.5" />
    </>
  ),
  open: (
    <>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v8.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v11" />
      <path d="M8 10l4 4 4-4" />
      <path d="M4 20h16" />
    </>
  ),
}

export function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {P[name] ?? null}
    </svg>
  )
}

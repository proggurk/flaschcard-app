// Line icons in the style of SF Symbols (24x24 grid, round strokes in currentColor)
import type { ReactNode } from 'react'

const ICONS = {
  calendar: <><rect x="3" y="4.5" width="18" height="17" rx="3.5" /><path d="M8 2.5v4M16 2.5v4M3 10h18" /></>,
  chart: <path d="M3 3v15a3 3 0 0 0 3 3h15M8 16v-4M13 16V7M18 16v-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  people: <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20.5v-.5a5.5 5.5 0 0 1 5.5-5.5h2a5.5 5.5 0 0 1 5.5 5.5v.5M16 4.2a3.5 3.5 0 0 1 0 7.6M21.5 20.5V20a5.5 5.5 0 0 0-3.5-5.1" />
  </>,
  person: <><circle cx="12" cy="12" r="9.5" /><circle cx="12" cy="10" r="3" /><path d="M6.5 18.7a6.5 6.5 0 0 1 11 0" /></>,
  chevronRight: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  chevronLeft: <path d="M15 5 8 12l7 7" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6.5 9.5 17 4 11.5" />,
  flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
  cloud: <path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z" />,
  cloudOff: <path d="M3 3l18 18M8.2 5.3A7 7 0 0 1 15.7 10h1.8a4.5 4.5 0 0 1 3 7.9M17 19H9a7 7 0 0 1-5-11.9" />,
  refresh: <path d="M20.5 11A8.5 8.5 0 0 0 5.6 6.4L3.5 8.5M3.5 3.5v5h5M3.5 13a8.5 8.5 0 0 0 14.9 4.6l2.1-2.1M20.5 20.5v-5h-5" />,
  fileImport: <path d="M14 2.5H7a2.5 2.5 0 0 0-2.5 2.5v14A2.5 2.5 0 0 0 7 21.5h10a2.5 2.5 0 0 0 2.5-2.5V8zM14 2.5V8h5.5M12 11v6.5M9 14.5l3 3 3-3" />,
  sparkles: <path d="M11 3.5 12.9 9 18.5 11l-5.6 2L11 18.5 9.1 13 3.5 11l5.6-2zM18.5 2.5v4M16.5 4.5h4" />,
  cards: <><rect x="3.5" y="6.5" width="13" height="15" rx="2.5" /><path d="M8 3.5h9a3 3 0 0 1 3 3v11" /></>,
  trophy: <path d="M8 21h8M12 16.5V21M7 3.5h10v6a5 5 0 0 1-10 0zM17 5h3v2a3.5 3.5 0 0 1-3.2 3.5M7 5H4v2a3.5 3.5 0 0 0 3.2 3.5" />,
  clock: <><circle cx="12" cy="12" r="9.5" /><path d="M12 6.5V12l3.5 2" /></>,
  exam: <path d="M22 9.5 12 4.5 2 9.5l10 5zM6 11.5v5c3.5 2.5 8.5 2.5 12 0v-5M22 9.5v5" />,
  logout: <path d="M9 21H5.5A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3H9M16 16.5l4.5-4.5L16 7.5M20.5 12H9" />,
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

export default function Icon({ name, size = 24, weight = 2 }: { name: IconName, size?: number, weight?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={weight}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  )
}

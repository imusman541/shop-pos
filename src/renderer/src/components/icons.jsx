import React from 'react'

const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }

export const IconDashboard = (p) => (
  <svg {...base} className="ico" {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </svg>
)

export const IconBox = (p) => (
  <svg {...base} className="ico" {...p}>
    <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="m3.3 7 8.7 5 8.7-5" />
    <path d="M12 22V12" />
  </svg>
)

export const IconCart = (p) => (
  <svg {...base} className="ico" {...p}>
    <circle cx="8" cy="21" r="1" />
    <circle cx="19" cy="21" r="1" />
    <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
  </svg>
)

export const IconUsers = (p) => (
  <svg {...base} className="ico" {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

export const IconWallet = (p) => (
  <svg {...base} className="ico" {...p}>
    <path d="M20 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z" />
    <path d="M16 12h.01" />
    <path d="M3 9V6a2 2 0 0 1 2-2h12" />
  </svg>
)

export const IconPlus = (p) => (
  <svg {...base} width="16" height="16" {...p}><path d="M12 5v14M5 12h14" /></svg>
)
export const IconExport = (p) => (
  <svg {...base} width="16" height="16" {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
  </svg>
)
export const IconImport = (p) => (
  <svg {...base} width="16" height="16" {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 9l5-5 5 5" /><path d="M12 4v12" />
  </svg>
)
export const IconEdit = (p) => (
  <svg {...base} width="15" height="15" {...p}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
  </svg>
)
export const IconTrash = (p) => (
  <svg {...base} width="15" height="15" {...p}>
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)

export const IconCalendar = (p) => (
  <svg {...base} width="16" height="16" {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
)

export const IconTrendUp = (p) => (
  <svg {...base} width="14" height="14" {...p}>
    <path d="m3 17 6-6 4 4 8-8" />
    <path d="M17 7h4v4" />
  </svg>
)

export const IconTrendDown = (p) => (
  <svg {...base} width="14" height="14" {...p}>
    <path d="m3 7 6 6 4-4 8 8" />
    <path d="M17 17h4v-4" />
  </svg>
)

export const IconLogout = (p) => (
  <svg {...base} className="ico" {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
)

export const IconInfo = (p) => (
  <svg {...base} width="14" height="14" {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
)

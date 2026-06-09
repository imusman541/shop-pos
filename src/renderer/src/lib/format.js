// Change CURRENCY to match your shop (e.g. '$', '£', 'Rs ', '₹').
export const CURRENCY = 'Rs '

export function money(n) {
  const v = Number(n) || 0
  return CURRENCY + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export function int(n) {
  return (Number(n) || 0).toLocaleString()
}

export function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return String(iso).slice(0, 10)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// yyyy-mm-dd for <input type="date">
export function toInputDate(d) {
  const x = new Date(d)
  const off = x.getTimezoneOffset()
  const local = new Date(x.getTime() - off * 60000)
  return local.toISOString().slice(0, 10)
}

export function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toInputDate(d)
}

export function parseInputDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function daysInRange(start, end) {
  const a = parseInputDate(start)
  const b = parseInputDate(end)
  return Math.round((b - a) / 86400000) + 1
}

export function addDays(iso, n) {
  const d = parseInputDate(iso)
  d.setDate(d.getDate() + n)
  return toInputDate(d)
}

export function previousPeriodDates(start, end) {
  const days = daysInRange(start, end)
  const prevEnd = addDays(start, -1)
  const prevStart = addDays(prevEnd, -(days - 1))
  return { startDate: prevStart, endDate: prevEnd, days }
}

export function pctChange(current, previous) {
  const c = Number(current) || 0
  const p = Number(previous) || 0
  if (p === 0) return c === 0 ? 0 : 100
  return ((c - p) / p) * 100
}

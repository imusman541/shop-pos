// Change CURRENCY to match your shop (e.g. '$', '£', 'Rs ', '₹').
export const CURRENCY = 'Rs '

export const money = (n) => {
  const v = Number(n) || 0
  return CURRENCY + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export const int = (n) => {
  return (Number(n) || 0).toLocaleString()
}

export const fmtDate = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return String(iso).slice(0, 10)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// yyyy-mm-dd for <input type="date">
export const toInputDate = (d) => {
  const x = new Date(d)
  const off = x.getTimezoneOffset()
  const local = new Date(x.getTime() - off * 60000)
  return local.toISOString().slice(0, 10)
}

export const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toInputDate(d)
}

export const parseInputDate = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const daysInRange = (start, end) => {
  const a = parseInputDate(start)
  const b = parseInputDate(end)
  return Math.round((b - a) / 86400000) + 1
}

export const addDays = (iso, n) => {
  const d = parseInputDate(iso)
  d.setDate(d.getDate() + n)
  return toInputDate(d)
}

export const previousPeriodDates = (start, end) => {
  const days = daysInRange(start, end)
  const prevEnd = addDays(start, -1)
  const prevStart = addDays(prevEnd, -(days - 1))
  return { startDate: prevStart, endDate: prevEnd, days }
}

export const pctChange = (current, previous) => {
  const c = Number(current) || 0
  const p = Number(previous) || 0
  if (p === 0) return c === 0 ? 0 : 100
  return ((c - p) / p) * 100
}

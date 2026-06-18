import React, { useEffect, useRef, useState } from 'react'
import { fmtDate, parseInputDate, toInputDate } from '../lib/format'
import { IconCalendar } from './icons'

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const toIso = (y, m, d) => {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const monthStart = (iso) => {
  const d = parseInputDate(iso)
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

const buildMonthGrid = (year, month) => {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const prevMonth = month === 0 ? 11 : month - 1
  const prevYear = month === 0 ? year - 1 : year
  const prevDays = new Date(prevYear, prevMonth + 1, 0).getDate()
  const cells = []

  for (let i = 0; i < firstDow; i++) {
    const day = prevDays - firstDow + i + 1
    cells.push({ iso: toIso(prevYear, prevMonth, day), outside: true })
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ iso: toIso(year, month, day), outside: false })
  }

  const nextMonth = month === 11 ? 0 : month + 1
  const nextYear = month === 11 ? year + 1 : year
  let nextDay = 1
  while (cells.length % 7 !== 0) {
    cells.push({ iso: toIso(nextYear, nextMonth, nextDay++), outside: true })
  }
  return cells
}

const normalizeRange = (a, b) => {
  return a <= b ? { start: a, end: b } : { start: b, end: a }
}

const inRange = (iso, start, end) => {
  return iso >= start && iso <= end
}

const DateRangePicker = ({ start, end, onChange, max }) => {
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => monthStart(start))
  const [draftStart, setDraftStart] = useState(null)
  const [hoverDate, setHoverDate] = useState(null)

  useEffect(() => {
    if (open) setViewMonth(monthStart(start))
  }, [open, start])

  useEffect(() => {
    if (!open) return undefined
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
        setDraftStart(null)
        setHoverDate(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const viewYear = viewMonth.getFullYear()
  const viewMonthIdx = viewMonth.getMonth()
  const cells = buildMonthGrid(viewYear, viewMonthIdx)
  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const previewEnd = draftStart && hoverDate ? normalizeRange(draftStart, hoverDate).end : null
  const previewStart = draftStart && hoverDate ? normalizeRange(draftStart, hoverDate).start : null

  const shiftMonth = (delta) => {
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1))
  }

  const handleDayClick = (iso) => {
    if (max && iso > max) return

    if (!draftStart) {
      setDraftStart(iso)
      return
    }

    const range = normalizeRange(draftStart, iso)
    onChange({ start: range.start, end: range.end })
    setDraftStart(null)
    setHoverDate(null)
    setOpen(false)
  }

  const handleClear = () => {
    setDraftStart(null)
    setHoverDate(null)
  }

  const handleToday = () => {
    const today = max || toInputDate(new Date())
    onChange({ start: today, end: today })
    setDraftStart(null)
    setHoverDate(null)
    setViewMonth(monthStart(today))
    setOpen(false)
  }

  const dayClass = (iso, outside) => {
    const disabled = max && iso > max
    const classes = ['cal-day']
    if (outside) classes.push('cal-day--outside')
    if (disabled) classes.push('cal-day--disabled')

    const rangeStart = draftStart ? (previewStart || draftStart) : start
    const rangeEnd = draftStart ? (previewEnd || draftStart) : end

    if (!disabled && inRange(iso, rangeStart, rangeEnd)) {
      classes.push('cal-day--in-range')
      if (iso === rangeStart) classes.push('cal-day--start')
      if (iso === rangeEnd) classes.push('cal-day--end')
    }
    return classes.join(' ')
  }

  return (
    <div className="field date-range-field" ref={rootRef}>
      <label>Date range</label>
      <button
        type="button"
        className={`date-range-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <IconCalendar />
        <span>{fmtDate(start)} – {fmtDate(end)}</span>
      </button>

      {open && (
        <div className="date-range-popover" role="dialog" aria-label="Choose date range">
          <div className="cal-head">
            <button type="button" className="cal-nav" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
            <span className="cal-month">{monthLabel}</span>
            <button type="button" className="cal-nav" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
          </div>

          <div className="cal-weekdays">
            {WEEKDAYS.map((d, i) => <span key={i}>{d}</span>)}
          </div>

          <div className="cal-grid">
            {cells.map(({ iso, outside }) => (
              <button
                key={iso + (outside ? '-o' : '')}
                type="button"
                className={dayClass(iso, outside)}
                disabled={max && iso > max}
                onClick={() => handleDayClick(iso)}
                onMouseEnter={() => { if (draftStart) setHoverDate(iso) }}
                onMouseLeave={() => setHoverDate(null)}
              >
                {parseInputDate(iso).getDate()}
              </button>
            ))}
          </div>

          {draftStart && !hoverDate && (
            <p className="cal-hint">Select end date</p>
          )}

          <div className="cal-foot">
            <button type="button" className="cal-foot-btn" onClick={handleClear}>Clear</button>
            <button type="button" className="cal-foot-btn primary" onClick={handleToday}>Today</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default DateRangePicker;

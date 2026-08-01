import React, { useEffect, useRef, useState } from 'react'

const STATUS_OPTIONS = [
  { value: 'PAID', label: 'Paid' },
  { value: 'NOT_PAID', label: 'Not paid' },
  { value: 'PARTIALLY_PAID', label: 'Partially Paid' },
  { value: 'CANCELLED', label: 'Cancelled' }
]

const StatusMultiSelect = ({ value = [], onChange, disabled }) => {
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)
  const selected = new Set(value)

  useEffect(() => {
    if (!open) return undefined
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const toggle = (statusValue) => {
    const next = new Set(selected)
    if (next.has(statusValue)) next.delete(statusValue)
    else next.add(statusValue)
    onChange([...next])
  }

  const label = selected.size === 0
    ? 'All statuses'
    : `${selected.size} status${selected.size === 1 ? '' : 'es'} selected`

  return (
    <div className="field multi-select-field field-filter" ref={rootRef}>
      <label>Status</label>
      <button
        type="button"
        className={`multi-select-trigger${open ? ' open' : ''}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
      >
        <span className={selected.size === 0 ? 'placeholder' : ''}>{label}</span>
      </button>

      {open && (
        <div className="multi-select-popover" role="listbox" aria-multiselectable="true">
          <div className="multi-select-list">
            {STATUS_OPTIONS.map((opt) => {
              const checked = selected.has(opt.value)
              return (
                <label key={opt.value} className="multi-select-option">
                  <input
                    type="checkbox"
                    className="row-check"
                    checked={checked}
                    onChange={() => toggle(opt.value)}
                  />
                  <span className="multi-select-option-text">{opt.label}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default StatusMultiSelect

import React, { useEffect, useRef, useState } from 'react'

const formatCustomer = (c) => {
  if (!c) return ''
  return `#${c.id} ${c.name}${c.phone ? ` · ${c.phone}` : ''}`
}

const CustomerSelect = ({
  customers,
  value = '',
  onChange,
  disabled,
  placeholder = 'Walk-in customer'
}) => {
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selected = customers.find((c) => String(c.id) === String(value))

  useEffect(() => {
    if (!open) return undefined
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const filtered = customers.filter((c) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      c.name.toLowerCase().includes(q)
      || String(c.id).includes(q)
      || (c.phone && c.phone.toLowerCase().includes(q))
    )
  })

  const pick = (id) => {
    onChange(id === '' ? '' : String(id))
    setOpen(false)
    setSearch('')
  }

  const label = selected ? formatCustomer(selected) : placeholder

  return (
    <div className="multi-select-field" ref={rootRef}>
      <button
        type="button"
        className={`multi-select-trigger${open ? ' open' : ''}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={selected ? '' : 'placeholder'}>{label}</span>
      </button>

      {open && (
        <div className="multi-select-popover" role="listbox">
          <input
            className="multi-select-search"
            type="text"
            placeholder="Search by name, phone, or #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="multi-select-list">
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className={`multi-select-option${!value ? ' selected' : ''}`}
              onClick={() => pick('')}
            >
              <span className="multi-select-option-text">{placeholder}</span>
            </button>
            {filtered.length === 0 ? (
              <div className="multi-select-empty">No customers match</div>
            ) : (
              filtered.map((c) => {
                const isSelected = String(value) === String(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`multi-select-option${isSelected ? ' selected' : ''}`}
                    onClick={() => pick(c.id)}
                  >
                    <span className="multi-select-option-text">
                      <span className="id-pill">#{c.id}</span>
                      {c.name}
                      {c.phone && <span className="customer-phone">{c.phone}</span>}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default CustomerSelect

import React, { useEffect, useRef, useState } from 'react'

export default function ProductMultiSelect({ products, value = [], onChange, disabled }) {
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selected = new Set(value.map((id) => Number(id)))

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

  const filtered = products.filter((p) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return p.name.toLowerCase().includes(q) || String(p.id).includes(q)
  })

  const toggle = (id) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }

  const label = selected.size === 0
    ? 'Search and select products…'
    : `${selected.size} product${selected.size === 1 ? '' : 's'} selected`

  return (
    <div className="field multi-select-field" ref={rootRef}>
      <label>Products</label>
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
          <input
            className="multi-select-search"
            type="text"
            placeholder="Search by name or #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="multi-select-list">
            {filtered.length === 0 ? (
              <div className="multi-select-empty">No products match</div>
            ) : (
              filtered.map((p) => (
                <label key={p.id} className="multi-select-option">
                  <input
                    type="checkbox"
                    className="row-check"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <span className="multi-select-option-text">
                    <span className="id-pill">#{p.id}</span>
                    {p.name}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

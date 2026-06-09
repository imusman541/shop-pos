import React from 'react'

export default function Pagination({ page, pageSize, total, onChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  // Compact window of page numbers around the current page.
  const pages = []
  const add = (p) => pages.push(p)
  const window = 1
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - window && p <= page + window)) {
      add(p)
    } else if (pages[pages.length - 1] !== '…') {
      add('…')
    }
  }

  return (
    <div className="pager">
      <span>
        Showing <strong className="num">{from}</strong>–<strong className="num">{to}</strong> of{' '}
        <strong className="num">{total}</strong>
      </span>
      <div className="pages">
        <button disabled={page <= 1} onClick={() => onChange(page - 1)}>‹</button>
        {pages.map((p, i) =>
          p === '…' ? (
            <button key={`e${i}`} disabled>…</button>
          ) : (
            <button key={p} className={p === page ? 'active' : ''} onClick={() => onChange(p)}>
              {p}
            </button>
          )
        )}
        <button disabled={page >= totalPages} onClick={() => onChange(page + 1)}>›</button>
      </div>
    </div>
  )
}

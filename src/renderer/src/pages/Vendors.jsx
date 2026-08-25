import React, { useCallback, useEffect, useState } from 'react'
import Drawer from '../components/Drawer'
import Modal from '../components/Modal'
import Pagination from '../components/Pagination'
import { useToast } from '../components/Toast'
import { fmtDate, money } from '../lib/format'
import { IconEdit, IconPlus, IconTrash } from '../components/icons'

const PAGE_SIZE = 25
const EMPTY_VENDOR = { name: '', phone: '', notes: '', opening_balance: '' }
const EMPTY_ENTRY = { amount: '', method: '', description: '' }

const parseDescriptionBullets = (text) => {
  if (!text || !String(text).trim()) return []
  const raw = String(text).trim()
  const parts = raw.includes('\n')
    ? raw.split('\n')
    : raw.split(/,\s*(?=[^\s,]|\d)/)
  return parts
    .map((line) => line.replace(/^[\s•\-\*]+/, '').trim())
    .filter(Boolean)
}

const normalizeDescriptionForSave = (text) => parseDescriptionBullets(text).join('\n')

const descriptionPreview = (text) => {
  const bullets = parseDescriptionBullets(text)
  if (!bullets.length) return text || '-'
  if (bullets.length === 1) return bullets[0]
  return `${bullets[0]} · +${bullets.length - 1} more`
}

const ensureBulletLines = (value) => {
  if (!value) return '• '
  return value
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return '• '
      if (/^[•\-\*]/.test(trimmed)) return line.startsWith('•') ? line : `• ${trimmed.replace(/^[\-\*]+\s*/, '')}`
      return `• ${trimmed}`
    })
    .join('\n')
}

const Vendors = () => {
  const toast = useToast()
  const [filters, setFilters] = useState({ search: '', balance: '' })
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(() => new Set())

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_VENDOR)
  const [saving, setSaving] = useState(false)

  const [viewing, setViewing] = useState(null)
  const [khata, setKhata] = useState(null)
  const [khataSelected, setKhataSelected] = useState(() => new Set())
  const [purchase, setPurchase] = useState(EMPTY_ENTRY)
  const [payment, setPayment] = useState(EMPTY_ENTRY)
  const [detailRow, setDetailRow] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await window.api.getVendors({ ...filters, page, pageSize: PAGE_SIZE })
    setData(res)
    setLoading(false)
  }, [filters, page])

  const loadKhata = useCallback(async (vendor) => {
    if (!vendor) return
    const res = await window.api.getVendorKhata(vendor.id)
    setKhata(res)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSelected(new Set()) }, [page, filters])
  useEffect(() => { setKhataSelected(new Set()) }, [viewing?.id])

  const updateFilter = (patch) => {
    setPage(1)
    setFilters((f) => ({ ...f, ...patch }))
  }

  const pageIds = data.rows.map((v) => v.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const somePageSelected = pageIds.some((id) => selected.has(id))
  const khataRows = khata?.rows || []
  const khataEntryIds = khataRows.map((row) => row.id)
  const allKhataSelected = khataEntryIds.length > 0 && khataEntryIds.every((id) => khataSelected.has(id))
  const someKhataSelected = khataEntryIds.some((id) => khataSelected.has(id))
  const selectedKhataIds = khataEntryIds.filter((id) => khataSelected.has(id))

  const balanceInfo = (value) => {
    const amount = Number(value) || 0
    if (amount > 0) return { label: 'You Owe', status: 'You Owe', badge: 'out', chip: 'owes', amount }
    return { label: 'Clear', status: 'Clear', badge: 'in', chip: 'paid', amount: 0 }
  }

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allPageSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
  }

  const toggleKhataSelect = (id) => {
    setKhataSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAllKhata = () => {
    setKhataSelected((prev) => {
      const next = new Set(prev)
      if (allKhataSelected) khataEntryIds.forEach((id) => next.delete(id))
      else khataEntryIds.forEach((id) => next.add(id))
      return next
    })
  }

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_VENDOR)
    setModalOpen(true)
  }

  const openEdit = (vendor) => {
    setEditing(vendor)
    setForm({
      name: vendor.name || '',
      phone: vendor.phone || '',
      notes: vendor.notes || '',
      opening_balance: ''
    })
    setModalOpen(true)
  }

  const openKhata = async (vendor) => {
    setViewing(vendor)
    setPurchase(EMPTY_ENTRY)
    setPayment(EMPTY_ENTRY)
    await loadKhata(vendor)
  }

  const save = async () => {
    if (!form.name.trim()) {
      toast('Please enter vendor name')
      return
    }

    setSaving(true)
    try {
      if (editing) {
        await window.api.updateVendor(editing.id, form)
        toast('Vendor updated')
      } else {
        const created = await window.api.createVendor(form)
        toast(`Vendor created · #${created.id}`)
      }
      setModalOpen(false)
      await load()
    } catch (err) {
      toast(err.message || 'Could not save vendor')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (vendor) => {
    if (!window.confirm(`Delete "${vendor.name}" and all vendor khata entries?`)) return
    const res = await window.api.deleteVendor(vendor.id)
    toast(`${res.count} vendor${res.count === 1 ? '' : 's'} deleted`)
    if (data.rows.length === 1 && page > 1) setPage(page - 1)
    else load()
  }

  const bulkRemove = async () => {
    const ids = [...selected]
    if (!ids.length) return
    const label = ids.length === 1 ? '1 vendor' : `${ids.length} vendors`
    if (!window.confirm(`Delete ${label} and all vendor khata entries?`)) return
    const res = await window.api.deleteVendors(ids)
    toast(`${res.count} vendor${res.count === 1 ? '' : 's'} deleted`)
    setSelected(new Set())
    if (data.rows.length <= ids.length && page > 1) setPage(page - 1)
    else load()
  }

  const addEntry = async (type) => {
    if (!viewing) return
    const source = type === 'payment' ? payment : purchase
    if (!Number(source.amount)) {
      toast('Enter an amount')
      return
    }

    const payload = {
      ...source,
      description: type === 'purchase'
        ? normalizeDescriptionForSave(source.description)
        : source.description
    }
    if (type === 'purchase' && !payload.description) {
      toast('Add at least one description item')
      return
    }

    try {
      if (type === 'payment') {
        await window.api.payVendor(viewing.id, payload)
        setPayment(EMPTY_ENTRY)
        toast('Payment to vendor recorded')
      } else {
        await window.api.addVendorPurchase(viewing.id, payload)
        setPurchase(EMPTY_ENTRY)
        toast('Purchase recorded')
      }
      await loadKhata(viewing)
      await load()
    } catch (err) {
      toast(err.message || 'Could not add vendor entry')
    }
  }

  const handlePurchaseDescriptionKeyDown = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    setPurchase((p) => {
      const current = p.description || '• '
      return { ...p, description: `${ensureBulletLines(current)}\n• ` }
    })
  }

  const addPurchaseBullet = () => {
    setPurchase((p) => {
      const current = (p.description || '').trim()
      if (!current) return { ...p, description: '• ' }
      return { ...p, description: `${ensureBulletLines(current)}\n• ` }
    })
  }

  const deleteKhataEntries = async (entryIds) => {
    if (!viewing || !entryIds.length) return
    const label = entryIds.length === 1 ? 'this vendor entry' : `${entryIds.length} vendor entries`
    if (!window.confirm(`Delete ${label}?`)) return

    const res = await window.api.deleteVendorKhataEntries(viewing.id, entryIds)
    toast(`${res.count} entr${res.count === 1 ? 'y' : 'ies'} deleted`)
    setKhataSelected(new Set())
    await loadKhata(viewing)
    await load()
  }

  const clearFilters = () => updateFilter({ search: '', balance: '' })
  const hasFilters = filters.search || filters.balance

  return (
    <div className="customers-page vendors-page">
      <div className="page-head">
        <div>
          <h1>Vendors</h1>
          <p>Track suppliers, purchases on credit, and payments you make.</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-primary" onClick={openCreate}><IconPlus /> Add Vendor</button>
        </div>
      </div>

      <div className="card toolbar customers-toolbar">
        <div className="field field-search">
          <label>Search vendor</label>
          <input
            placeholder="Search name or phone..."
            value={filters.search}
            onChange={(e) => updateFilter({ search: e.target.value })}
          />
        </div>
        <div className="field field-filter">
          <label>Balance</label>
          <select value={filters.balance} onChange={(e) => updateFilter({ balance: e.target.value })}>
            <option value="">All</option>
            <option value="pending">You Owe</option>
            <option value="clear">Clear</option>
          </select>
        </div>
        {hasFilters && <button className="btn btn-ghost" onClick={clearFilters}>Clear</button>}
      </div>

      <div className="card customers-table-card">
        {selected.size > 0 && (
          <div className="bulk-bar">
            <span>{selected.size} selected</span>
            <div className="bulk-bar-actions">
              <button className="btn btn-sm btn-danger" onClick={bulkRemove}>
                <IconTrash /> Delete selected
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          </div>
        )}
        <div className="table-wrap">
          <table className="customers-table vendors-table">
            <thead>
              <tr>
                <th className="check-col sticky-col sticky-col-check">
                  <input
                    type="checkbox"
                    className="row-check"
                    checked={allPageSelected}
                    ref={(el) => { if (el) el.indeterminate = somePageSelected && !allPageSelected }}
                    onChange={toggleSelectAll}
                    disabled={loading || data.rows.length === 0}
                    aria-label="Select all on this page"
                  />
                </th>
                <th className="sticky-col sticky-col-name">Name</th>
                <th>Vendor #</th>
                <th>Phone</th>
                <th>Total Purchased</th>
                <th>Total Paid</th>
                <th>You Owe</th>
                <th>Last Transaction</th>
                <th>Status</th>
                <th className="sticky-col sticky-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10}><div className="empty-state"><span className="spinner" /></div></td></tr>
              ) : data.rows.length === 0 ? (
                <tr><td colSpan={10}>
                  <div className="empty-state">
                    <strong>No vendors found</strong>
                    Add a vendor to start tracking purchases and payments.
                  </div>
                </td></tr>
              ) : (
                data.rows.map((v) => {
                  const info = balanceInfo(v.balance)
                  return (
                    <tr key={v.id} className={selected.has(v.id) ? 'row-selected' : ''}>
                      <td className="check-col sticky-col sticky-col-check">
                        <input
                          type="checkbox"
                          className="row-check"
                          checked={selected.has(v.id)}
                          onChange={() => toggleSelect(v.id)}
                          aria-label={`Select ${v.name}`}
                        />
                      </td>
                      <td className="sticky-col sticky-col-name">
                        <button type="button" className="order-items-link" onClick={() => openKhata(v)}>
                          {v.name}
                        </button>
                      </td>
                      <td><span className="id-pill">#{v.id}</span></td>
                      <td>{v.phone || <span className="muted-dash">-</span>}</td>
                      <td className="num"><span className="money-chip purchased">{money(v.total_purchased)}</span></td>
                      <td className="num"><span className="money-chip paid">{money(v.total_paid)}</span></td>
                      <td className="num"><span className={`money-chip ${info.chip}`}>{money(info.amount)}</span></td>
                      <td>{v.last_transaction ? fmtDate(v.last_transaction) : <span className="muted-dash">-</span>}</td>
                      <td>
                        <span className={`badge ${info.badge}`}>{info.status}</span>
                      </td>
                      <td className="sticky-col sticky-col-actions">
                        <div className="row-actions">
                          <button className="btn btn-sm" onClick={() => openKhata(v)}>View</button>
                          <button className="btn btn-sm" onClick={() => openEdit(v)}><IconEdit /></button>
                          <button className="btn btn-sm btn-danger" onClick={() => remove(v)}><IconTrash /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onChange={setPage} />
      </div>

      <Drawer
        open={modalOpen}
        title={editing ? `Edit Vendor · #${editing.id}` : 'Add Vendor'}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : (editing ? 'Save changes' : 'Add vendor')}
            </button>
          </>
        }
      >
        <div className="form-stack">
          <div>
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <div>
            <label>Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          {!editing && (
            <div>
              <label>Opening Balance <span className="label-note">(optional)</span></label>
              <input
                type="number"
                min="0"
                step="any"
                value={form.opening_balance}
                onChange={(e) => setForm((f) => ({ ...f, opening_balance: e.target.value }))}
                placeholder="Amount already owed to vendor"
              />
            </div>
          )}
        </div>
      </Drawer>

      <Drawer
        wide
        className="khata-drawer"
        open={!!viewing}
        title={khata ? (
          <span className="khata-titlebar">
            <span className="khata-title-name">{khata.vendor.name} · Vendor Khata</span>
            <span className="khata-title-balance">
              <span>{balanceInfo(khata.vendor.balance).label}</span>
              <span>=</span>
              <span className={`money-chip ${balanceInfo(khata.vendor.balance).chip}`}>
                {money(balanceInfo(khata.vendor.balance).amount)}
              </span>
            </span>
          </span>
        ) : 'Vendor Khata'}
        onClose={() => { setViewing(null); setKhata(null); setKhataSelected(new Set()) }}
        footer={
          <button className="btn" onClick={() => { setViewing(null); setKhata(null); setKhataSelected(new Set()) }}>
            Close
          </button>
        }
      >
        {khata && (
          <div className="khata-detail">
            <div className="khata-summary">
              <div className="khata-summary-card purchased">
                <span>Total Purchased</span>
                <strong>{money(khata.vendor.total_purchased)}</strong>
              </div>
              <div className="khata-summary-card paid">
                <span>Total Paid</span>
                <strong>{money(khata.vendor.total_paid)}</strong>
              </div>
              <div className={`khata-summary-card ${balanceInfo(khata.vendor.balance).chip}`}>
                <span>{balanceInfo(khata.vendor.balance).label}</span>
                <strong>{money(balanceInfo(khata.vendor.balance).amount)}</strong>
              </div>
            </div>

            <div className="khata-actions vendor-khata-actions">
              <div className="khata-entry-card">
                <h3>Record Purchase</h3>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Amount"
                  value={purchase.amount}
                  onChange={(e) => setPurchase((p) => ({ ...p, amount: e.target.value }))}
                />
                <div className="vendor-desc-field">
                  <div className="vendor-desc-field-head">
                    <label>Description (bullet list)</label>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={addPurchaseBullet}>
                      + Add item
                    </button>
                  </div>
                  <textarea
                    className="vendor-bullet-textarea"
                    rows={5}
                    placeholder={"• 3 molty foam\n• 10 alizeh foam\n• 50kg cotton"}
                    value={purchase.description}
                    onFocus={() => {
                      if (!purchase.description) setPurchase((p) => ({ ...p, description: '• ' }))
                    }}
                    onChange={(e) => setPurchase((p) => ({ ...p, description: e.target.value }))}
                    onKeyDown={handlePurchaseDescriptionKeyDown}
                    onBlur={() => {
                      if (purchase.description) {
                        setPurchase((p) => ({ ...p, description: ensureBulletLines(p.description) }))
                      }
                    }}
                  />
                  <div className="field-hint">Press Enter to add another bullet item.</div>
                </div>
                <button className="btn btn-solid-danger" onClick={() => addEntry('purchase')}>
                  Add purchase
                </button>
              </div>

              <div className="khata-entry-card">
                <h3>Pay Vendor</h3>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Amount"
                  value={payment.amount}
                  onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
                />
                <select value={payment.method} onChange={(e) => setPayment((p) => ({ ...p, method: e.target.value }))}>
                  <option value="">Method</option>
                  <option>Cash</option>
                  <option>Bank</option>
                  <option>JazzCash</option>
                  <option>Easypaisa</option>
                  <option>Other</option>
                </select>
                <input
                  placeholder="Description"
                  value={payment.description}
                  onChange={(e) => setPayment((p) => ({ ...p, description: e.target.value }))}
                />
                <button className="btn btn-success" onClick={() => addEntry('payment')}>
                  Record payment
                </button>
              </div>
            </div>

            {khataSelected.size > 0 && (
              <div className="bulk-bar khata-bulk-bar">
                <span>{khataSelected.size} selected</span>
                <div className="bulk-bar-actions">
                  <button className="btn btn-sm btn-danger" onClick={() => deleteKhataEntries(selectedKhataIds)}>
                    <IconTrash /> Delete selected
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setKhataSelected(new Set())}>
                    Clear
                  </button>
                </div>
              </div>
            )}

            <div className="table-wrap">
              <table className="khata-table">
                <thead>
                  <tr>
                    <th className="check-col">
                      <input
                        type="checkbox"
                        className="row-check"
                        checked={allKhataSelected}
                        ref={(el) => { if (el) el.indeterminate = someKhataSelected && !allKhataSelected }}
                        onChange={toggleSelectAllKhata}
                        disabled={khataRows.length === 0}
                        aria-label="Select all vendor entries"
                      />
                    </th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Purchase</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {khataRows.length === 0 ? (
                    <tr><td colSpan={8}><div className="empty-state">No vendor entries yet.</div></td></tr>
                  ) : (
                    khataRows.map((row) => (
                      <tr key={row.id} className={khataSelected.has(row.id) ? 'row-selected' : ''}>
                        <td className="check-col">
                          <input
                            type="checkbox"
                            className="row-check"
                            checked={khataSelected.has(row.id)}
                            onChange={() => toggleKhataSelect(row.id)}
                            aria-label={`Select vendor entry ${row.id}`}
                          />
                        </td>
                        <td>{fmtDate(row.created_at)}</td>
                        <td>
                          <span className={`badge ${row.type === 'purchase' ? 'out' : 'in'}`}>
                            {row.type === 'purchase' ? 'Purchase' : 'Paid'}
                          </span>
                        </td>
                        <td className="khata-description-cell">
                          {row.description ? (
                            <button
                              type="button"
                              className="khata-description khata-description-link"
                              onClick={() => setDetailRow(row)}
                              title="View full description"
                            >
                              {descriptionPreview(row.description)}
                            </button>
                          ) : (
                            <span className="muted-dash">-</span>
                          )}
                        </td>
                        <td className="num">{row.type === 'purchase' ? money(row.amount) : '-'}</td>
                        <td className="num">{row.type === 'payment' ? money(row.amount) : '-'}</td>
                        <td className="num"><strong>{money(row.running_balance)}</strong></td>
                        <td>
                          <button className="btn btn-sm btn-danger" onClick={() => deleteKhataEntries([row.id])}>
                            <IconTrash />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Drawer>

      {detailRow && (
        <Modal
          title={detailRow.type === 'purchase' ? 'Purchase details' : 'Payment details'}
          onClose={() => setDetailRow(null)}
          footer={
            <button className="btn btn-primary" onClick={() => setDetailRow(null)}>Close</button>
          }
        >
          <div className="vendor-detail-modal">
            <div className="vendor-detail-meta">
              <div>
                <span className="vendor-detail-label">Date</span>
                <strong>{fmtDate(detailRow.created_at)}</strong>
              </div>
              <div>
                <span className="vendor-detail-label">Type</span>
                <span className={`badge ${detailRow.type === 'purchase' ? 'out' : 'in'}`}>
                  {detailRow.type === 'purchase' ? 'Purchase' : 'Paid'}
                </span>
              </div>
              <div>
                <span className="vendor-detail-label">
                  {detailRow.type === 'purchase' ? 'Purchase amount' : 'Paid amount'}
                </span>
                <strong className="num">{money(detailRow.amount)}</strong>
              </div>
              <div>
                <span className="vendor-detail-label">Balance after</span>
                <strong className="num">{money(detailRow.running_balance)}</strong>
              </div>
              {detailRow.method ? (
                <div>
                  <span className="vendor-detail-label">Method</span>
                  <strong>{detailRow.method}</strong>
                </div>
              ) : null}
            </div>

            <div className="vendor-detail-desc">
              <span className="vendor-detail-label">Description</span>
              {parseDescriptionBullets(detailRow.description).length > 0 ? (
                <ul className="vendor-detail-bullets">
                  {parseDescriptionBullets(detailRow.description).map((item, idx) => (
                    <li key={`${item}-${idx}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted-dash">No description</p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default Vendors

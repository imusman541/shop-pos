import React, { useCallback, useEffect, useState } from 'react'
import Drawer from '../components/Drawer'
import Pagination from '../components/Pagination'
import { useToast } from '../components/Toast'
import { fmtDate, money } from '../lib/format'
import { IconEdit, IconExport, IconPlus, IconTrash } from '../components/icons'

const PAGE_SIZE = 25
const EMPTY_CUSTOMER = { name: '', phone: '', address: '', notes: '', opening_balance: '' }
const EMPTY_ENTRY = { amount: '', method: '', description: '' }

const Customers = () => {
  const toast = useToast()
  const [filters, setFilters] = useState({ search: '', balance: '' })
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(() => new Set())

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_CUSTOMER)
  const [saving, setSaving] = useState(false)

  const [viewing, setViewing] = useState(null)
  const [khata, setKhata] = useState(null)
  const [khataSelected, setKhataSelected] = useState(() => new Set())
  const [payment, setPayment] = useState(EMPTY_ENTRY)
  const [charge, setCharge] = useState({ ...EMPTY_ENTRY, method: '' })
  const [payable, setPayable] = useState({ ...EMPTY_ENTRY, method: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const res = await window.api.getCustomers({ ...filters, page, pageSize: PAGE_SIZE })
    setData(res)
    setLoading(false)
  }, [filters, page])

  const loadKhata = useCallback(async (customer) => {
    if (!customer) return
    const res = await window.api.getCustomerKhata(customer.id)
    setKhata(res)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSelected(new Set()) }, [page, filters])
  useEffect(() => { setKhataSelected(new Set()) }, [viewing?.id])

  const updateFilter = (patch) => {
    setPage(1)
    setFilters((f) => ({ ...f, ...patch }))
  }

  const pageIds = data.rows.map((c) => c.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const somePageSelected = pageIds.some((id) => selected.has(id))
  const khataRows = khata?.rows || []
  const khataEntryIds = khataRows.map((row) => row.id)
  const allKhataSelected = khataEntryIds.length > 0 && khataEntryIds.every((id) => khataSelected.has(id))
  const someKhataSelected = khataEntryIds.some((id) => khataSelected.has(id))
  const selectedKhataIds = khataEntryIds.filter((id) => khataSelected.has(id))
  const typeLabel = (type) => {
    if (type === 'debit') return 'Not Paid'
    if (type === 'payable') return 'To Pay'
    return 'Paid'
  }
  const typeClass = (type) => type === 'debit' ? 'out' : type === 'payable' ? 'payable' : 'in'
  const balanceInfo = (value) => {
    const amount = Number(value) || 0
    if (amount > 0) return { label: 'Customer Owes', status: 'Customer Owes', badge: 'out', chip: 'owes', amount }
    if (amount < 0) return { label: 'We Pay Customer', status: 'We Pay', badge: 'payable', chip: 'payable', amount: Math.abs(amount) }
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
    setForm(EMPTY_CUSTOMER)
    setModalOpen(true)
  }

  const openEdit = (customer) => {
    setEditing(customer)
    setForm({
      name: customer.name || '',
      phone: customer.phone || '',
      address: customer.address || '',
      notes: customer.notes || '',
      opening_balance: ''
    })
    setModalOpen(true)
  }

  const openKhata = async (customer) => {
    setViewing(customer)
    setPayment(EMPTY_ENTRY)
    setCharge({ ...EMPTY_ENTRY, method: '' })
    setPayable({ ...EMPTY_ENTRY, method: '' })
    await loadKhata(customer)
  }

  const save = async () => {
    if (!form.name.trim()) {
      toast('Please enter customer name')
      return
    }

    setSaving(true)
    try {
      if (editing) {
        await window.api.updateCustomer(editing.id, form)
        toast('Customer updated')
      } else {
        const created = await window.api.createCustomer(form)
        toast(`Customer created · #${created.id}`)
      }
      setModalOpen(false)
      await load()
    } catch (err) {
      toast(err.message || 'Could not save customer')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (customer) => {
    if (!window.confirm(`Delete "${customer.name}" and all khata entries?`)) return
    const res = await window.api.deleteCustomer(customer.id)
    toast(`${res.count} customer${res.count === 1 ? '' : 's'} deleted`)
    if (data.rows.length === 1 && page > 1) setPage(page - 1)
    else load()
  }

  const bulkRemove = async () => {
    const ids = [...selected]
    if (!ids.length) return
    const label = ids.length === 1 ? '1 customer' : `${ids.length} customers`
    if (!window.confirm(`Delete ${label} and all khata entries?`)) return
    const res = await window.api.deleteCustomers(ids)
    toast(`${res.count} customer${res.count === 1 ? '' : 's'} deleted`)
    setSelected(new Set())
    if (data.rows.length <= ids.length && page > 1) setPage(page - 1)
    else load()
  }

  const addEntry = async (type) => {
    if (!viewing) return
    const source = type === 'payment' ? payment : type === 'payable' ? payable : charge
    if (!Number(source.amount)) {
      toast('Enter an amount')
      return
    }

    try {
      if (type === 'payment') {
        await window.api.receiveCustomerPayment(viewing.id, source)
        setPayment(EMPTY_ENTRY)
        toast('Payment recorded')
      } else if (type === 'payable') {
        await window.api.addCustomerPayable(viewing.id, source)
        setPayable({ ...EMPTY_ENTRY, method: '' })
        toast('Amount to pay customer added')
      } else {
        await window.api.addCustomerCharge(viewing.id, source)
        setCharge({ ...EMPTY_ENTRY, method: '' })
        toast('Khata charge added')
      }
      await loadKhata(viewing)
      await load()
    } catch (err) {
      toast(err.message || 'Could not add khata entry')
    }
  }

  const downloadKhata = async (customer, entryIds = []) => {
    const res = await window.api.exportCustomerKhata(customer.id, entryIds)
    if (!res.canceled) {
      const scope = entryIds.length ? `${entryIds.length} selected entr${entryIds.length === 1 ? 'y' : 'ies'}` : 'khata'
      toast(`Downloaded ${scope} for ${customer.name}`)
    }
  }

  const sendKhataToWhatsApp = async (customer, entryIds = []) => {
    const res = await window.api.shareCustomerKhataOnWhatsApp(customer.id, entryIds)
    if (!res.canceled) {
      const scope = entryIds.length ? `${entryIds.length} selected entr${entryIds.length === 1 ? 'y' : 'ies'}` : 'khata'
      toast(`${res.openedDirectChat ? 'Customer WhatsApp chat opened' : 'WhatsApp opened'}. ${scope} PDF is revealed and its path is copied.`)
    }
  }

  const deleteKhataEntries = async (entryIds) => {
    if (!viewing || !entryIds.length) return
    const label = entryIds.length === 1 ? 'this khata entry' : `${entryIds.length} khata entries`
    if (!window.confirm(`Delete ${label}?`)) return

    const res = await window.api.deleteCustomerKhataEntries(viewing.id, entryIds)
    toast(`${res.count} entr${res.count === 1 ? 'y' : 'ies'} deleted`)
    setKhataSelected(new Set())
    await loadKhata(viewing)
    await load()
  }

  const clearFilters = () => updateFilter({ search: '', balance: '' })
  const hasFilters = filters.search || filters.balance

  return (
    <div className="customers-page">
      <div className="page-head">
        <div>
          <h1>Customers Khata</h1>
          <p>Track customers, unpaid orders, payments, and running balances.</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-primary" onClick={openCreate}><IconPlus /> Add Customer</button>
        </div>
      </div>

      <div className="card toolbar customers-toolbar">
        <div className="field field-search">
          <label>Search customer</label>
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
            <option value="pending">Customer Owes</option>
            <option value="payable">We Pay Customer</option>
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
          <table className="customers-table">
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
                <th>Customer #</th>
                <th>Phone</th>
                <th>Total Purchased</th>
                <th>Total Paid</th>
                <th>We Pay</th>
                <th>Balance</th>
                <th>Last Transaction</th>
                <th>Status</th>
                <th className="sticky-col sticky-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11}><div className="empty-state"><span className="spinner" /></div></td></tr>
              ) : data.rows.length === 0 ? (
                <tr><td colSpan={11}>
                  <div className="empty-state">
                    <strong>No customers found</strong>
                    Add a customer to start tracking khata.
                  </div>
                </td></tr>
              ) : (
                data.rows.map((c) => {
                  const info = balanceInfo(c.balance)
                  return (
                    <tr key={c.id} className={selected.has(c.id) ? 'row-selected' : ''}>
                      <td className="check-col sticky-col sticky-col-check">
                        <input
                          type="checkbox"
                          className="row-check"
                          checked={selected.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                          aria-label={`Select ${c.name}`}
                        />
                      </td>
                      <td className="sticky-col sticky-col-name">
                        <button type="button" className="order-items-link" onClick={() => openKhata(c)}>
                          {c.name}
                        </button>
                      </td>
                      <td><span className="id-pill">#{c.id}</span></td>
                      <td>{c.phone || <span className="muted-dash">-</span>}</td>
                      <td className="num"><span className="money-chip purchased">{money(c.total_purchased)}</span></td>
                      <td className="num"><span className="money-chip paid">{money(c.total_paid)}</span></td>
                      <td className="num"><span className="money-chip payable">{money(c.total_payable)}</span></td>
                      <td className="num"><span className={`money-chip ${info.chip}`}>{money(info.amount)}</span></td>
                      <td>{c.last_transaction ? fmtDate(c.last_transaction) : <span className="muted-dash">-</span>}</td>
                      <td>
                        <span className={`badge ${info.badge}`}>
                          {info.status}
                        </span>
                      </td>
                      <td className="sticky-col sticky-col-actions">
                        <div className="row-actions">
                          <button className="btn btn-sm" onClick={() => openKhata(c)}>View</button>
                          <button className="btn btn-sm" onClick={() => openEdit(c)}><IconEdit /></button>
                          <button className="btn btn-sm" onClick={() => downloadKhata(c)}><IconExport /></button>
                          <button className="btn btn-sm btn-danger" onClick={() => remove(c)}><IconTrash /></button>
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
        title={editing ? `Edit Customer · #${editing.id}` : 'Add Customer'}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : (editing ? 'Save changes' : 'Add customer')}
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
            <label>Address</label>
            <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
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
                placeholder="Amount already owed"
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
            <span className="khata-title-name">{khata.customer.name} · Khata</span>
            <span className="khata-title-balance">
              <span>{balanceInfo(khata.customer.balance).label === 'Clear' ? 'Total Amount' : balanceInfo(khata.customer.balance).label}</span>
              <span>=</span>
              <span className={`money-chip ${balanceInfo(khata.customer.balance).chip}`}>
                {money(balanceInfo(khata.customer.balance).amount)}
              </span>
            </span>
          </span>
        ) : 'Customer Khata'}
        onClose={() => { setViewing(null); setKhata(null); setKhataSelected(new Set()) }}
        footer={
          <>
            {khata && (
              <>
                <button
                  className="btn"
                  onClick={() => sendKhataToWhatsApp(khata.customer)}
                  disabled={khata.rows.length === 0}
                >
                  Send All WhatsApp
                </button>
                <button
                  className="btn"
                  onClick={() => downloadKhata(khata.customer)}
                  disabled={khata.rows.length === 0}
                >
                  <IconExport /> Download All PDF
                </button>
              </>
            )}
            <button className="btn" onClick={() => { setViewing(null); setKhata(null); setKhataSelected(new Set()) }}>Close</button>
          </>
        }
      >
        {khata && (
          <div className="khata-detail">
            <div className="khata-summary">
              <div className="khata-summary-card purchased"><span>Total Purchased</span><strong>{money(khata.customer.total_purchased)}</strong></div>
              <div className="khata-summary-card paid"><span>Total Paid</span><strong>{money(khata.customer.total_paid)}</strong></div>
              <div className="khata-summary-card payable"><span>Total To Pay</span><strong>{money(khata.customer.total_payable)}</strong></div>
              <div className={`khata-summary-card ${balanceInfo(khata.customer.balance).chip}`}>
                <span>{balanceInfo(khata.customer.balance).label}</span>
                <strong>{money(balanceInfo(khata.customer.balance).amount)}</strong>
              </div>
            </div>

            <div className="khata-actions">
              <div className="khata-entry-card">
                <h3>Receive Payment</h3>
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
                <button className="btn btn-success" onClick={() => addEntry('payment')}>Record payment</button>
              </div>

              <div className="khata-entry-card">
                <h3>Add Khata Charge</h3>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Amount"
                  value={charge.amount}
                  onChange={(e) => setCharge((p) => ({ ...p, amount: e.target.value }))}
                />
                <input
                  placeholder="Description"
                  value={charge.description}
                  onChange={(e) => setCharge((p) => ({ ...p, description: e.target.value }))}
                />
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Amount"
                  value={charge.amount}
                  style={{ visibility: 'hidden' }}
                  onChange={(e) => setCharge((p) => ({ ...p, amount: e.target.value }))}
                />
                <button className="btn btn-solid-danger" onClick={() => addEntry('charge')}>Add charge</button>
              </div>

              <div className="khata-entry-card">
                <h3>We Need To Pay Customer</h3>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Amount"
                  value={payable.amount}
                  onChange={(e) => setPayable((p) => ({ ...p, amount: e.target.value }))}
                />
                <select value={payable.method} onChange={(e) => setPayable((p) => ({ ...p, method: e.target.value }))}>
                  <option value="">Method</option>
                  <option>Cash</option>
                  <option>Bank</option>
                  <option>JazzCash</option>
                  <option>Easypaisa</option>
                  <option>Other</option>
                </select>
                <input
                  placeholder="Description"
                  value={payable.description}
                  onChange={(e) => setPayable((p) => ({ ...p, description: e.target.value }))}
                />
                <button className="btn btn-primary" onClick={() => addEntry('payable')}>Add to pay</button>
              </div>
            </div>

            {khataSelected.size > 0 && (
              <div className="bulk-bar khata-bulk-bar">
                <span>{khataSelected.size} selected</span>
                <div className="bulk-bar-actions">
                  <button className="btn btn-sm" onClick={() => sendKhataToWhatsApp(khata.customer, selectedKhataIds)}>
                    Send selected WhatsApp
                  </button>
                  <button className="btn btn-sm" onClick={() => downloadKhata(khata.customer, selectedKhataIds)}>
                    <IconExport /> Download selected PDF
                  </button>
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
                        aria-label="Select all khata entries"
                      />
                    </th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Not Paid</th>
                    <th>Paid</th>
                    <th>To Pay</th>
                    <th>Balance</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {khataRows.length === 0 ? (
                    <tr><td colSpan={9}><div className="empty-state">No khata entries yet.</div></td></tr>
                  ) : (
                    khataRows.map((row) => (
                      <tr key={row.id} className={khataSelected.has(row.id) ? 'row-selected' : ''}>
                        <td className="check-col">
                          <input
                            type="checkbox"
                            className="row-check"
                            checked={khataSelected.has(row.id)}
                            onChange={() => toggleKhataSelect(row.id)}
                            aria-label={`Select khata entry ${row.id}`}
                          />
                        </td>
                        <td>{fmtDate(row.created_at)}</td>
                        <td><span className={`badge ${typeClass(row.type)}`}>{typeLabel(row.type)}</span></td>
                        <td className="khata-description-cell">
                          <span className="khata-description" title={row.description || ''}>
                            {row.description || '-'}
                          </span>
                        </td>
                        <td className="num">{row.type === 'debit' ? money(row.amount) : '-'}</td>
                        <td className="num">{row.type === 'credit' ? money(row.amount) : '-'}</td>
                        <td className="num">{row.type === 'payable' ? money(row.amount) : '-'}</td>
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
    </div>
  )
}

export default Customers;

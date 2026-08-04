import React, { useEffect, useState, useCallback, useMemo } from 'react'
import Drawer from '../components/Drawer'
import DateRangePicker from '../components/DateRangePicker'
import ProductMultiSelect from '../components/ProductMultiSelect'
import StatusMultiSelect from '../components/StatusMultiSelect'
import Pagination from '../components/Pagination'
import { useToast } from '../components/Toast'
import { money, int, fmtDate, daysAgo } from '../lib/format'
import { IconPlus, IconExport, IconEdit, IconTrash, IconInfo } from '../components/icons'

const PAGE_SIZE = 25
const EMPTY = { status: 'PAID', customer_id: '', paid_amount: '', items: [] }

const orderQty = (items) => {
  return items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)
}

const orderTotal = (items) => {
  return items.reduce((s, i) => s + (Number(i.total_price) || 0), 0)
}

const orderProfit = (items) => {
  return items.reduce((s, i) => s + (Number(i.profit) || 0), 0)
}

const lineCost = (item) => {
  return (Number(item.unit_cost) || 0) * (Number(item.quantity) || 0)
}

const orderCost = (items) => {
  return items.reduce((s, i) => s + lineCost(i), 0)
}

const productCountLabel = (items) => {
  const n = items.length
  if (!n) return null
  return `${n} product${n === 1 ? '' : 's'}`
}

const isValidTotalPrice = (v) => {
  if (v === '' || v === null || v === undefined) return false
  const n = Number(v)
  return Number.isFinite(n) && n > 0
}

const statusBadgeClass = (status) => {
  if (status === 'PAID' || status === 'DONE') return 'paid'
  if (status === 'NOT_PAID') return 'unpaid'
  if (status === 'PARTIALLY_PAID') return 'partial'
  return 'cancelled'
}

const statusLabel = (status) => {
  if (status === 'PAID' || status === 'DONE') return 'Paid'
  if (status === 'NOT_PAID') return 'Not paid'
  if (status === 'PARTIALLY_PAID') return 'Partially Paid'
  if (status === 'CANCELLED') return 'Cancelled'
  return status
}

const resolveFormStatus = (requestedStatus, paidAmount, total) => {
  if (requestedStatus === 'CANCELLED') return 'CANCELLED'
  const paid = Math.max(0, Number(paidAmount) || 0)
  const orderTot = Math.max(0, Number(total) || 0)
  if (orderTot <= 0 || paid + 0.009 >= orderTot) return 'PAID'
  if (paid <= 0.009) return 'NOT_PAID'
  return 'PARTIALLY_PAID'
}

const TotalPriceLabel = () => {
  return (
    <span className="label-with-info">
      Total Price
      <span className="info-tip" tabIndex={0} aria-label="This price includes the profit as well.">
        <IconInfo />
        <span className="info-tip-text">This price includes the profit as well.</span>
      </span>
    </span>
  )
}

const Orders = () => {
  const toast = useToast()
  const [filters, setFilters] = useState({
    orderId: '', productId: '', productName: '', customerName: '',
    startDate: daysAgo(30), endDate: daysAgo(0), status: []
  })
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)

  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [viewingOrder, setViewingOrder] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(() => new Set())

  const fetchOrders = useCallback(async (query) => {
    setLoading(true)
    const res = await window.api.getOrders({ pageSize: PAGE_SIZE, ...query })
    setData(res)
    setLoading(false)
    return res
  }, [])

  const load = useCallback(async () => {
    await fetchOrders({ ...filters, page })
  }, [filters, page, fetchOrders])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSelected(new Set()) }, [page, filters])

  useEffect(() => {
    window.api.listProductsBrief().then(setProducts)
    window.api.listCustomersBrief().then(setCustomers)
  }, [modalOpen])

  const updateFilter = (patch) => { setPage(1); setFilters((f) => ({ ...f, ...patch })) }

  const handleRangeChange = ({ start, end }) => {
    updateFilter({ startDate: start, endDate: end })
  }

  const pageIds = data.rows.map((o) => o.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const somePageSelected = pageIds.some((id) => selected.has(id))

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

  const selectedProductIds = useMemo(
    () => form.items.map((i) => Number(i.product_id)).filter(Boolean),
    [form.items]
  )

  const formOrderTotal = useMemo(() => orderTotal(form.items), [form.items])
  const formRemaining = Math.max(0, formOrderTotal - (Number(form.paid_amount) || 0))

  const applyStatus = (nextStatus) => {
    setForm((f) => {
      const total = orderTotal(f.items)
      if (nextStatus === 'CANCELLED') {
        return { ...f, status: 'CANCELLED' }
      }
      if (nextStatus === 'PAID') {
        return {
          ...f,
          status: 'PAID',
          paid_amount: total > 0 ? String(total) : (f.paid_amount === '' ? '0' : f.paid_amount)
        }
      }
      if (nextStatus === 'NOT_PAID') {
        return { ...f, status: 'NOT_PAID', paid_amount: '0' }
      }
      // PARTIALLY_PAID — keep current paid if already partial; otherwise clear so user enters it
      const paid = Number(f.paid_amount) || 0
      const alreadyPartial = total > 0 && paid > 0.009 && paid + 0.009 < total
      return {
        ...f,
        status: 'PARTIALLY_PAID',
        paid_amount: alreadyPartial ? f.paid_amount : ''
      }
    })
  }

  const applyPaidAmount = (value) => {
    setForm((f) => {
      if (f.status === 'CANCELLED') {
        return { ...f, paid_amount: value }
      }
      const total = orderTotal(f.items)
      return {
        ...f,
        paid_amount: value,
        status: resolveFormStatus(f.status, value, total)
      }
    })
  }

  const syncProducts = (ids) => {
    setForm((f) => {
      const idSet = new Set(ids.map(Number))
      const kept = f.items.filter((i) => idSet.has(Number(i.product_id)))
      const keptIds = new Set(kept.map((i) => Number(i.product_id)))
      const added = ids
        .filter((id) => !keptIds.has(Number(id)))
        .map((id) => {
          const p = products.find((x) => x.id === id)
          return {
            product_id: id,
            product_name: p?.name || '',
            quantity: 1,
            total_price: ''
          }
        })
      return { ...f, items: [...kept, ...added] }
    })
  }

  const updateLine = (index, patch) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((item, i) => (i === index ? { ...item, ...patch } : item))
    }))
  }

  const removeLine = (index) => {
    setForm((f) => ({
      ...f,
      items: f.items.filter((_, i) => i !== index)
    }))
  }

  const openCreate = () => { setEditing(null); setForm(EMPTY); setModalOpen(true) }

  const openEdit = (o) => {
    setEditing(o)
    setForm({
      status: o.status,
      customer_id: o.customer_id || '',
      paid_amount: o.paid_amount ?? '',
      items: o.items.map((i) => ({
        product_id: i.product_id,
        product_name: i.product_name,
        quantity: i.quantity,
        total_price: i.total_price,
        unit_cost: i.unit_cost
      }))
    })
    setModalOpen(true)
  }

  const save = async () => {
    if (!form.items.length) {
      toast('Select at least one product'); return
    }
    const invalid = form.items.find((i) => !isValidTotalPrice(i.total_price))
    if (invalid) {
      toast(`Enter a total price for ${invalid.product_name || 'each product'}`)
      return
    }
    const total = orderTotal(form.items)
    const paid = form.paid_amount === '' ? 0 : Number(form.paid_amount)
    if (form.paid_amount !== '' && !Number.isFinite(Number(form.paid_amount))) {
      toast('Enter a valid paid amount')
      return
    }
    if (Number.isFinite(paid) && paid < 0) {
      toast('Paid amount cannot be negative')
      return
    }
    if (Number.isFinite(paid) && paid > total + 0.009) {
      toast('Paid amount cannot exceed order total')
      return
    }
    if (form.status === 'PARTIALLY_PAID' && (paid <= 0.009 || paid + 0.009 >= total)) {
      toast('For Partially Paid, enter an amount greater than 0 and less than the order total')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        status: resolveFormStatus(form.status, paid, total),
        paid_amount: paid
      }
      if (editing) {
        await window.api.updateOrder(editing.id, payload)
        toast('Order updated')
        setModalOpen(false)
        await load()
      } else {
        const created = await window.api.createOrder(payload)
        toast(`Order created · #${created.id}`)
        setModalOpen(false)

        const today = daysAgo(0)
        const nextEndDate = filters.endDate < today ? today : filters.endDate
        const nextStartDate = filters.startDate > today ? today : filters.startDate
        const nextFilters = {
          ...filters,
          startDate: nextStartDate,
          endDate: nextEndDate
        }

        if (nextEndDate !== filters.endDate || nextStartDate !== filters.startDate) {
          setFilters(nextFilters)
        }
        if (page !== 1) {
          setPage(1)
        }

        await fetchOrders({ ...nextFilters, page: 1 })
      }
    } catch (err) {
      toast(err.message || 'Could not save order')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (o) => {
    if (!window.confirm(`Delete order #${o.id}? It will be removed from the list.`)) return
    await window.api.deleteOrder(o.id)
    toast('Order deleted')
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(o.id)
      return next
    })
    if (data.rows.length === 1 && page > 1) setPage(page - 1)
    else load()
  }

  const bulkRemove = async () => {
    const ids = [...selected]
    if (!ids.length) return
    const label = ids.length === 1 ? '1 order' : `${ids.length} orders`
    if (!window.confirm(`Delete ${label}? They will be removed from the list.`)) return
    const res = await window.api.deleteOrders(ids)
    toast(`${res.count} order${res.count === 1 ? '' : 's'} deleted`)
    setSelected(new Set())
    if (data.rows.length <= ids.length && page > 1) setPage(page - 1)
    else load()
  }

  const doExport = async () => {
    const res = await window.api.exportOrders()
    if (!res.canceled) toast(`Exported ${res.count} orders`)
  }

  const clearFilters = () => {
    updateFilter({
      orderId: '', productId: '', productName: '', customerName: '',
      startDate: daysAgo(30), endDate: daysAgo(0), status: []
    })
  }

  const hasFilters = filters.orderId !== '' || filters.productId !== '' || filters.productName !== ''
    || filters.customerName !== ''
    || filters.status.length > 0
    || filters.startDate !== daysAgo(30) || filters.endDate !== daysAgo(0)

  return (
    <div className="orders-page">
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <p>Record sales. Dashboard sales count when payments are received.</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={doExport}><IconExport /> Export</button>
          <button className="btn btn-primary" onClick={openCreate}><IconPlus /> Create Order</button>
        </div>
      </div>

      <div className="card toolbar orders-toolbar">
        <div className="field field-id">
          <label>Order ID</label>
          <input type="number" placeholder="#" value={filters.orderId}
            onChange={(e) => updateFilter({ orderId: e.target.value })} />
        </div>
        <div className="field field-id">
          <label>Product ID</label>
          <input type="number" placeholder="#" value={filters.productId}
            onChange={(e) => updateFilter({ productId: e.target.value })} />
        </div>
        <div className="field field-search">
          <label>Product name</label>
          <input placeholder="Search name…" value={filters.productName}
            onChange={(e) => updateFilter({ productName: e.target.value })} />
        </div>
        <div className="field field-search">
          <label>Customer name</label>
          <input placeholder="Search customer…" value={filters.customerName}
            onChange={(e) => updateFilter({ customerName: e.target.value })} />
        </div>
        <DateRangePicker
          start={filters.startDate}
          end={filters.endDate}
          max={daysAgo(0)}
          onChange={handleRangeChange}
        />
        <StatusMultiSelect
          value={filters.status}
          onChange={(status) => updateFilter({ status })}
        />
        {hasFilters && (
          <button className="btn btn-ghost" onClick={clearFilters}>Clear</button>
        )}
      </div>

      <div className="card orders-table-card">
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
          <table className="orders-table">
            <thead>
              <tr>
                <th className="check-col">
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
                <th>Order #</th>
                <th>Products</th>
                <th>Customer</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Paid</th>
                <th className="sticky-col sticky-col-total">Total</th>
                <th className="sticky-col sticky-col-profit">Profit</th>
                <th className="sticky-col sticky-col-date">Date</th>
                <th className="sticky-col sticky-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11}><div className="empty-state"><span className="spinner" /></div></td></tr>
              ) : data.rows.length === 0 ? (
                <tr><td colSpan={11}>
                  <div className="empty-state">
                    <strong>No orders found</strong>
                    Create an order or adjust the filters.
                  </div>
                </td></tr>
              ) : (
                data.rows.map((o) => (
                  <tr key={o.id} className={selected.has(o.id) ? 'row-selected' : ''}>
                    <td className="check-col">
                      <input
                        type="checkbox"
                        className="row-check"
                        checked={selected.has(o.id)}
                        onChange={() => toggleSelect(o.id)}
                        aria-label={`Select order #${o.id}`}
                      />
                    </td>
                    <td><span className="id-pill">#{o.id}</span></td>
                    <td className="col-products">
                      {o.items.length === 0 ? (
                        <span className="muted-dash">—</span>
                      ) : (
                        <button
                          type="button"
                          className="order-items-link"
                          onClick={() => setViewingOrder(o)}
                        >
                          {productCountLabel(o.items)}
                        </button>
                      )}
                    </td>
                    <td>{o.customer_name || <span className="muted-dash">—</span>}</td>
                    <td className="num">{int(orderQty(o.items))}</td>
                    <td>
                      <span className={`badge ${statusBadgeClass(o.status)}`}>
                        {statusLabel(o.status)}
                      </span>
                    </td>
                    <td className="num">{money(o.paid_amount)}</td>
                    <td className="num sticky-col sticky-col-total"><strong>{money(orderTotal(o.items))}</strong></td>
                    <td className="num sticky-col sticky-col-profit"><strong>{money(orderProfit(o.items))}</strong></td>
                    <td className="col-date sticky-col sticky-col-date">{fmtDate(o.created_at)}</td>
                    <td className="sticky-col sticky-col-actions">
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => openEdit(o)}><IconEdit /></button>
                        <button className="btn btn-sm btn-danger" onClick={() => remove(o)}><IconTrash /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onChange={setPage} />
      </div>

      <Drawer
        wide
        className="order-items-drawer"
        open={!!viewingOrder}
        title={viewingOrder ? `Order #${viewingOrder.id} · Products` : ''}
        onClose={() => setViewingOrder(null)}
        footer={
          <button className="btn" onClick={() => setViewingOrder(null)}>Close</button>
        }
      >
        {viewingOrder && (
          <div className="order-items-detail">
            <div className="table-wrap">
              <table className="order-items-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Cost</th>
                    <th>Total Price</th>
                    <th>Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {viewingOrder.items.map((item) => (
                    <tr key={item.id ?? `${item.product_id}-${item.product_name}`}>
                      <td className="order-item-name">{item.product_name}</td>
                      <td className="num">{int(item.quantity)}</td>
                      <td className="num">{money(lineCost(item))}</td>
                      <td className="num">{money(item.total_price)}</td>
                      <td className="num">{money(item.profit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td><strong>Total</strong></td>
                    <td className="num"><strong>{int(orderQty(viewingOrder.items))}</strong></td>
                    <td className="num"><strong>{money(orderCost(viewingOrder.items))}</strong></td>
                    <td className="num"><strong>{money(orderTotal(viewingOrder.items))}</strong></td>
                    <td className="num">
                      <strong>{money(orderProfit(viewingOrder.items))}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {(viewingOrder.payments?.length > 0 || Number(viewingOrder.paid_amount) > 0) && (
              <div className="order-payments-block">
                <div className="order-lines-head">Payments</div>
                <div className="table-wrap">
                  <table className="order-items-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(viewingOrder.payments || []).map((p) => (
                        <tr key={p.id}>
                          <td>{fmtDate(p.created_at)}</td>
                          <td className="num">{money(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td><strong>Paid / Remaining</strong></td>
                        <td className="num">
                          <strong>
                            {money(viewingOrder.paid_amount)}
                            {Number(viewingOrder.remaining_amount) > 0
                              ? ` · ${money(viewingOrder.remaining_amount)} due`
                              : ''}
                          </strong>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Drawer
        open={modalOpen}
        title={editing ? `Edit Order · #${editing.id}` : 'Create Order'}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : (editing ? 'Save changes' : 'Create order')}
            </button>
          </>
        }
      >
        <div className="form-stack">
          <ProductMultiSelect
            products={products}
            value={selectedProductIds}
            onChange={syncProducts}
          />

          {form.items.length > 0 && (
            <div className="order-lines">
              <div className="order-lines-head">Line items</div>
              {form.items.map((item, index) => (
                <div key={`${item.product_id}-${index}`} className="order-line">
                  <div className="order-line-title">
                    <span className="id-pill">#{item.product_id}</span>
                    <span>{item.product_name}</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost order-line-remove"
                      onClick={() => removeLine(index)}
                      aria-label="Remove product"
                    >
                      <IconTrash />
                    </button>
                  </div>
                  <div className="order-line-fields">
                    <div>
                      <label>Qty</label>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateLine(index, { quantity: e.target.value })}
                      />
                    </div>
                    <div>
                      <label><TotalPriceLabel /></label>
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        required
                        value={item.total_price}
                        onChange={(e) => updateLine(index, { total_price: e.target.value })}
                        placeholder="Line total"
                      />
                    </div>
                  </div>
                </div>
              ))}
              <div className="order-lines-summary">
                <span>Order total</span>
                <strong>{money(formOrderTotal)}</strong>
              </div>
            </div>
          )}

          <div className="form-grid-two">
            <div>
              <label>Customer <span className="label-note">(optional)</span></label>
              <select
                value={form.customer_id}
                onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
              >
                <option value="">Walk-in customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.id} {c.name}{c.phone ? ` · ${c.phone}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>
                <span className="label-with-info">
                  Paid Amount
                  <span className="info-tip" tabIndex={0} aria-label="Sales are counted on the date this payment is recorded.">
                    <IconInfo />
                    <span className="info-tip-text">
                      Sales appear on the dashboard on the date you record each payment. Increasing paid amount later adds a new payment for today.
                    </span>
                  </span>
                </span>
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={form.paid_amount}
                onChange={(e) => applyPaidAmount(e.target.value)}
                placeholder="e.g. 500"
              />
              {formOrderTotal > 0 && (
                <div className="field-hint">
                  {formRemaining > 0.009
                    ? `${money(formRemaining)} remaining`
                    : 'Fully paid'}
                </div>
              )}
            </div>
          </div>

          <div>
            <label>Status</label>
            <select
              value={form.status}
              onChange={(e) => applyStatus(e.target.value)}
            >
              <option value="PAID">Paid</option>
              <option value="NOT_PAID">Not paid</option>
              <option value="PARTIALLY_PAID">Partially Paid</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            {form.status === 'PARTIALLY_PAID' && !(Number(form.paid_amount) > 0) && (
              <div className="field-hint">Enter a paid amount greater than 0 and less than the order total.</div>
            )}
          </div>
        </div>
      </Drawer>
    </div>
  )
}

export default Orders;

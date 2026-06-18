import React, { useEffect, useState, useCallback, useMemo } from 'react'
import Drawer from '../components/Drawer'
import DateRangePicker from '../components/DateRangePicker'
import ProductMultiSelect from '../components/ProductMultiSelect'
import Pagination from '../components/Pagination'
import { useToast } from '../components/Toast'
import { money, int, fmtDate, daysAgo } from '../lib/format'
import { IconPlus, IconExport, IconEdit, IconTrash, IconInfo } from '../components/icons'

const PAGE_SIZE = 25
const EMPTY = { status: 'DONE', customer_id: '', paid_amount: '', items: [] }

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
    orderId: '', productId: '', productName: '', startDate: daysAgo(30), endDate: daysAgo(0), status: ''
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

  const load = useCallback(async () => {
    setLoading(true)
    const res = await window.api.getOrders({ ...filters, page, pageSize: PAGE_SIZE })
    setData(res)
    setLoading(false)
  }, [filters, page])

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
      paid_amount: o.paid_amount || '',
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
    setSaving(true)
    try {
      if (editing) {
        await window.api.updateOrder(editing.id, form)
        toast('Order updated')
      } else {
        const created = await window.api.createOrder(form)
        toast(`Order created · #${created.id}`)
      }
      setModalOpen(false)
      await load()
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
      orderId: '', productId: '', productName: '',
      startDate: daysAgo(30), endDate: daysAgo(0), status: ''
    })
  }

  const hasFilters = filters.orderId !== '' || filters.productId !== '' || filters.productName !== ''
    || filters.status !== ''
    || filters.startDate !== daysAgo(30) || filters.endDate !== daysAgo(0)

  return (
    <div className="orders-page">
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <p>Record sales. Each order gets a unique order number.</p>
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
        <DateRangePicker
          start={filters.startDate}
          end={filters.endDate}
          max={daysAgo(0)}
          onChange={handleRangeChange}
        />
        <div className="field field-filter">
          <label>Status</label>
          <select value={filters.status} onChange={(e) => updateFilter({ status: e.target.value })}>
            <option value="">All</option>
            <option value="DONE">Done</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
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
                <th className="sticky-col sticky-col-total">Total</th>
                <th className="sticky-col sticky-col-profit">Profit</th>
                <th className="sticky-col sticky-col-date">Date</th>
                <th className="sticky-col sticky-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10}><div className="empty-state"><span className="spinner" /></div></td></tr>
              ) : data.rows.length === 0 ? (
                <tr><td colSpan={10}>
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
                    <td><span className={`badge ${o.status === 'DONE' ? 'done' : 'cancelled'}`}>{o.status}</span></td>
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
              <label>Paid Amount</label>
              <input
                type="number"
                min="0"
                step="any"
                value={form.paid_amount}
                onChange={(e) => setForm((f) => ({ ...f, paid_amount: e.target.value }))}
                placeholder="e.g. 500"
              />
            </div>
          </div>

          <div>
            <label>Status</label>
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="DONE">Done</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>
      </Drawer>
    </div>
  )
}

export default Orders;

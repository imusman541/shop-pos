import React, { useEffect, useState, useCallback } from 'react'
import Drawer from '../components/Drawer'
import DateRangePicker from '../components/DateRangePicker'
import Pagination from '../components/Pagination'
import { useToast } from '../components/Toast'
import { money, int, fmtDate, daysAgo } from '../lib/format'
import { IconPlus, IconExport, IconEdit, IconTrash } from '../components/icons'

const PAGE_SIZE = 25
const EMPTY = { product_id: '', product_name: '', quantity: 1, price: '', margin: '', status: 'DONE' }

export default function Orders() {
  const toast = useToast()
  const [filters, setFilters] = useState({
    orderId: '', productId: '', productName: '', startDate: daysAgo(30), endDate: daysAgo(0), status: ''
  })
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)

  const [products, setProducts] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await window.api.getOrders({ ...filters, page, pageSize: PAGE_SIZE })
    setData(res)
    setLoading(false)
  }, [filters, page])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    window.api.listProductsBrief().then(setProducts)
  }, [modalOpen])

  const updateFilter = (patch) => { setPage(1); setFilters((f) => ({ ...f, ...patch })) }

  const handleRangeChange = ({ start, end }) => {
    updateFilter({ startDate: start, endDate: end })
  }

  const openCreate = () => { setEditing(null); setForm(EMPTY); setModalOpen(true) }
  const openEdit = (o) => {
    setEditing(o)
    setForm({
      product_id: o.product_id ?? '', product_name: o.product_name ?? '',
      quantity: o.quantity, price: o.price, margin: o.margin, status: o.status
    })
    setModalOpen(true)
  }

  const onPickProduct = (id) => {
    const p = products.find((x) => String(x.id) === String(id))
    setForm((f) => ({
      ...f,
      product_id: id,
      product_name: p ? p.name : f.product_name,
      price: p ? p.net_price : f.price,
      margin: p ? p.margin : f.margin
    }))
  }

  const save = async () => {
    if (!form.product_id && !form.product_name.trim()) {
      toast('Pick a product or enter a product name'); return
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
    } finally {
      setSaving(false)
    }
  }

  const remove = async (o) => {
    if (!window.confirm(`Delete order #${o.id}? This cannot be undone.`)) return
    await window.api.deleteOrder(o.id)
    toast('Order deleted')
    if (data.rows.length === 1 && page > 1) setPage(page - 1)
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
        <div className="table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Product #</th>
                <th>Product Name</th>
                <th className="right">Qty</th>
                <th className="right">Price</th>
                <th className="right">Margin</th>
                <th className="right">Total</th>
                <th>Status</th>
                <th className="sticky-col sticky-col-date">Date</th>
                <th className="right sticky-col sticky-col-actions">Actions</th>
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
                  <tr key={o.id}>
                    <td><span className="id-pill">#{o.id}</span></td>
                    <td>{o.product_id ? <span className="id-pill">#{o.product_id}</span> : <span className="muted-dash">—</span>}</td>
                    <td className="col-name">{o.product_name}</td>
                    <td className="right num">{int(o.quantity)}</td>
                    <td className="right num">{money(o.price)}</td>
                    <td className="right num">{money(o.margin)}</td>
                    <td className="right num"><strong>{money(o.price * o.quantity)}</strong></td>
                    <td><span className={`badge ${o.status === 'DONE' ? 'done' : 'cancelled'}`}>{o.status}</span></td>
                    <td className="col-date sticky-col sticky-col-date">{fmtDate(o.created_at)}</td>
                    <td className="right sticky-col sticky-col-actions">
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
          <div>
            <label>Product</label>
            <select value={form.product_id} onChange={(e) => onPickProduct(e.target.value)}>
              <option value="">— Select a product —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>#{p.id} · {p.name}</option>
              ))}
            </select>
            <div className="hint">Picking a product auto-fills its name, price and margin. You can still override them.</div>
          </div>

          <div>
            <label>Product name</label>
            <input value={form.product_name}
              onChange={(e) => setForm((f) => ({ ...f, product_name: e.target.value }))}
              placeholder="Product name" />
          </div>

          <div>
            <label>Quantity</label>
            <input type="number" min="1" value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
          </div>

          <div>
            <label>Status</label>
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="DONE">Done</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          <div>
            <label>Price <span className="label-note">(optional)</span></label>
            <input type="number" value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              placeholder="From product" />
          </div>

          <div>
            <label>Margin / Profit <span className="label-note">(optional)</span></label>
            <input type="number" value={form.margin}
              onChange={(e) => setForm((f) => ({ ...f, margin: e.target.value }))}
              placeholder="From product" />
          </div>
        </div>
      </Drawer>
    </div>
  )
}

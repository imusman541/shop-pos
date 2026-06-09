import React, { useEffect, useState, useCallback } from 'react'
import Drawer from '../components/Drawer'
import ProductThumb from '../components/ProductThumb'
import Pagination from '../components/Pagination'
import { useToast } from '../components/Toast'
import { money, int } from '../lib/format'
import {
  IconPlus, IconExport, IconImport, IconEdit, IconTrash
} from '../components/icons'

const PAGE_SIZE = 25
const EMPTY = { name: '', image: null, quantity: '', net_price: '', margin: '', status: 'in_stock' }

export default function Products() {
  const toast = useToast()
  const [filters, setFilters] = useState({ search: '', status: '', priceOp: 'gt', priceValue: '' })
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null) // null = create
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(() => new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const res = await window.api.getProducts({
      search: filters.search,
      status: filters.status,
      priceOp: filters.priceValue !== '' ? filters.priceOp : '',
      priceValue: filters.priceValue,
      page,
      pageSize: PAGE_SIZE
    })
    setData(res)
    setLoading(false)
  }, [filters, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSelected(new Set()) }, [page, filters])

  // Reset to page 1 whenever filters change.
  const updateFilter = (patch) => { setPage(1); setFilters((f) => ({ ...f, ...patch })) }

  const pageIds = data.rows.map((p) => p.id)
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

  const openCreate = () => { setEditing(null); setForm(EMPTY); setModalOpen(true) }
  const openEdit = (p) => {
    setEditing(p)
    setForm({
      name: p.name, image: p.image,
      quantity: p.quantity, net_price: p.net_price,
      margin: p.margin, status: p.status
    })
    setModalOpen(true)
  }

  const onImage = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setForm((f) => ({ ...f, image: reader.result }))
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!form.name.trim()) { toast('Please enter a product name'); return }
    setSaving(true)
    try {
      if (editing) {
        await window.api.updateProduct(editing.id, form)
        toast('Product updated')
      } else {
        const created = await window.api.createProduct(form)
        toast(`Product created · #${created.id}`)
      }
      setModalOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p) => {
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return
    await window.api.deleteProduct(p.id)
    toast('Product deleted')
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(p.id)
      return next
    })
    // If we deleted the last row on the page, step back a page.
    if (data.rows.length === 1 && page > 1) setPage(page - 1)
    else load()
  }

  const bulkRemove = async () => {
    const ids = [...selected]
    if (!ids.length) return
    const label = ids.length === 1 ? '1 product' : `${ids.length} products`
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return
    const res = await window.api.deleteProducts(ids)
    toast(`${res.count} product${res.count === 1 ? '' : 's'} deleted`)
    setSelected(new Set())
    if (data.rows.length <= ids.length && page > 1) setPage(page - 1)
    else load()
  }

  const doExport = async () => {
    const res = await window.api.exportProducts()
    if (!res.canceled) toast(`Exported ${res.count} products`)
  }
  const doImport = async () => {
    const res = await window.api.importProducts()
    if (!res.canceled) { toast(`Imported ${res.count} products`); setPage(1); load() }
  }

  return (
    <div className="products-page">
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <p>Manage your inventory. Each product gets a unique product number.</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={doImport}><IconImport /> Upload Excel</button>
          <button className="btn" onClick={doExport}><IconExport /> Export</button>
          <button className="btn btn-primary" onClick={openCreate}><IconPlus /> Create Product</button>
        </div>
      </div>

      <div className="card toolbar products-toolbar">
        <div className="field field-search">
          <label>Search by name</label>
          <input
            placeholder="Search products…"
            value={filters.search}
            onChange={(e) => updateFilter({ search: e.target.value })}
          />
        </div>
        <div className="field field-filter">
          <label>Status</label>
          <select value={filters.status} onChange={(e) => updateFilter({ status: e.target.value })}>
            <option value="">All</option>
            <option value="in_stock">In Stock</option>
            <option value="out_of_stock">Out of Stock</option>
          </select>
        </div>
        <div className="field field-filter">
          <label>Price is</label>
          <select value={filters.priceOp} onChange={(e) => updateFilter({ priceOp: e.target.value })}>
            <option value="gt">Greater than</option>
            <option value="lt">Less than</option>
            <option value="eq">Equal to</option>
          </select>
        </div>
        <div className="field field-amount">
          <label>Amount</label>
          <input
            type="number"
            placeholder="e.g. 100"
            value={filters.priceValue}
            onChange={(e) => updateFilter({ priceValue: e.target.value })}
          />
        </div>
        {(filters.search || filters.status || filters.priceValue !== '') && (
          <button className="btn btn-ghost" onClick={() => updateFilter({ search: '', status: '', priceValue: '' })}>
            Clear
          </button>
        )}
      </div>

      <div className="card products-table-card">
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
          <table>
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
                <th>Product #</th>
                <th>Image</th>
                <th>Name</th>
                <th className="right">Quantity</th>
                <th className="right">Net Price</th>
                <th className="right">Margin / Profit</th>
                <th>Status</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9}><div className="empty-state"><span className="spinner" /></div></td></tr>
              ) : data.rows.length === 0 ? (
                <tr><td colSpan={9}>
                  <div className="empty-state">
                    <strong>No products found</strong>
                    Create your first product or adjust the filters.
                  </div>
                </td></tr>
              ) : (
                data.rows.map((p) => (
                  <tr key={p.id} className={selected.has(p.id) ? 'row-selected' : ''}>
                    <td className="check-col">
                      <input
                        type="checkbox"
                        className="row-check"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        aria-label={`Select ${p.name}`}
                      />
                    </td>
                    <td><span className="id-pill">#{p.id}</span></td>
                    <td>
                      <ProductThumb src={p.image} name={p.name} />
                    </td>
                    <td>{p.name}</td>
                    <td className="right num">{int(p.quantity)}</td>
                    <td className="right num">{money(p.net_price)}</td>
                    <td className="right num">{money(p.margin)}</td>
                    <td>
                      <span className={`badge ${p.status === 'in_stock' ? 'in' : 'out'}`}>
                        {p.status === 'in_stock' ? 'In Stock' : 'Out of Stock'}
                      </span>
                    </td>
                    <td className="right">
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => openEdit(p)}><IconEdit /></button>
                        <button className="btn btn-sm btn-danger" onClick={() => remove(p)}><IconTrash /></button>
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
        title={editing ? `Edit Product · #${editing.id}` : 'Create Product'}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : (editing ? 'Save changes' : 'Create product')}
            </button>
          </>
        }
      >
          <div className="form-stack">
            <div>
              <label>Image</label>
              <div className="img-picker">
                {form.image
                  ? <img className="preview" src={form.image} alt="preview" />
                  : <div className="preview">No image</div>}
                <div>
                  <input type="file" accept="image/*" onChange={onImage} />
                  {form.image && (
                    <button className="btn btn-sm btn-ghost" style={{ marginTop: 6 }}
                      onClick={() => setForm((f) => ({ ...f, image: null }))}>Remove</button>
                  )}
                </div>
              </div>
            </div>

            <div>
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Product name" />
            </div>

            <div>
              <label>Quantity</label>
              <input type="number" value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
            </div>

            <div>
              <label>Status</label>
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="in_stock">In Stock</option>
                <option value="out_of_stock">Out of Stock</option>
              </select>
            </div>

            <div>
              <label>Net Price</label>
              <input type="number" value={form.net_price}
                onChange={(e) => setForm((f) => ({ ...f, net_price: e.target.value }))} />
            </div>

            <div>
              <label>Margin / Profit</label>
              <input type="number" value={form.margin}
                onChange={(e) => setForm((f) => ({ ...f, margin: e.target.value }))} />
            </div>
          </div>
      </Drawer>
    </div>
  )
}

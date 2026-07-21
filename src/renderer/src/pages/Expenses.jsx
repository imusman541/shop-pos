import React, { useCallback, useEffect, useState } from 'react'
import Drawer from '../components/Drawer'
import Pagination from '../components/Pagination'
import { useToast } from '../components/Toast'
import { fmtDate, money } from '../lib/format'
import { IconEdit, IconPlus, IconTrash } from '../components/icons'

const PAGE_SIZE = 25
const EMPTY_EXPENSE = { title: '', amount: '', method: 'Cash', notes: '' }
const EMPTY_BALANCE = { amount: '', method: 'Cash', description: '' }

const Expenses = () => {
  const toast = useToast()
  const [filters, setFilters] = useState({ search: '' })
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ rows: [], total: 0, wallet: { balance: 0, total_added: 0, total_spent: 0 } })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(() => new Set())

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_EXPENSE)
  const [saving, setSaving] = useState(false)

  const [balanceOpen, setBalanceOpen] = useState(false)
  const [balanceForm, setBalanceForm] = useState(EMPTY_BALANCE)
  const [savingBalance, setSavingBalance] = useState(false)

  const wallet = data.wallet || { balance: 0, total_added: 0, total_spent: 0 }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.api.getExpenses({ ...filters, page, pageSize: PAGE_SIZE })
      setData(res)
    } finally {
      setLoading(false)
    }
  }, [filters, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSelected(new Set()) }, [page, filters])

  const updateFilter = (patch) => {
    setPage(1)
    setFilters((f) => ({ ...f, ...patch }))
  }

  const pageIds = data.rows.map((e) => e.id)
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

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_EXPENSE)
    setModalOpen(true)
  }

  const openEdit = (expense) => {
    setEditing(expense)
    setForm({
      title: expense.title || '',
      amount: String(expense.amount ?? ''),
      method: expense.method || 'Cash',
      notes: expense.notes || ''
    })
    setModalOpen(true)
  }

  const openAddBalance = () => {
    setBalanceForm(EMPTY_BALANCE)
    setBalanceOpen(true)
  }

  const saveExpense = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) {
      toast('Please enter expense title')
      return
    }
    if (!editing && !(Number(form.amount) > 0)) {
      toast('Please enter expense amount')
      return
    }

    setSaving(true)
    try {
      if (editing) {
        await window.api.updateExpense(editing.id, {
          title: form.title,
          notes: form.notes,
          method: form.method
        })
        toast('Expense updated')
      } else {
        await window.api.createExpense({
          title: form.title,
          amount: form.amount,
          notes: form.notes,
          method: form.method
        })
        toast('Expense added and deducted from balance')
      }
      setModalOpen(false)
      await load()
    } catch (err) {
      toast(err.message || 'Could not save expense')
    } finally {
      setSaving(false)
    }
  }

  const saveBalance = async (e) => {
    e.preventDefault()
    if (!(Number(balanceForm.amount) > 0)) {
      toast('Please enter an amount to add')
      return
    }

    setSavingBalance(true)
    try {
      await window.api.addExpenseBalance(balanceForm)
      toast('Balance added')
      setBalanceOpen(false)
      await load()
    } catch (err) {
      toast(err.message || 'Could not add balance')
    } finally {
      setSavingBalance(false)
    }
  }

  const remove = async (expense) => {
    if (!window.confirm(`Delete "${expense.title}"? The amount will be restored to your balance.`)) return
    const res = await window.api.deleteExpense(expense.id)
    toast(`${res.count} expense${res.count === 1 ? '' : 's'} deleted`)
    await load()
  }

  const removeSelected = async () => {
    const ids = [...selected]
    if (!ids.length) return
    const label = ids.length === 1 ? '1 expense' : `${ids.length} expenses`
    if (!window.confirm(`Delete ${label}? Amounts will be restored to your balance.`)) return
    const res = await window.api.deleteExpenses(ids)
    toast(`${res.count} expense${res.count === 1 ? '' : 's'} deleted`)
    setSelected(new Set())
    await load()
  }

  return (
    <div className="expenses-page">
      <div className="page-head">
        <div>
          <h1>Expenses</h1>
          <p>Add balance to your wallet, then deduct from it when you record an expense.</p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn btn-ghost" onClick={openAddBalance}>
            <IconPlus /> Add Balance
          </button>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <IconPlus /> Add Expense
          </button>
        </div>
      </div>

      <div className="expense-wallet-summary">
        <div className="khata-summary-card paid">
          <span>Available Balance</span>
          <strong>{money(wallet.balance)}</strong>
        </div>
        <div className="khata-summary-card purchased">
          <span>Total Added</span>
          <strong>{money(wallet.total_added)}</strong>
        </div>
        <div className="khata-summary-card owes">
          <span>Total Spent</span>
          <strong>{money(wallet.total_spent)}</strong>
        </div>
      </div>

      <div className="card toolbar expenses-toolbar">
        <div className="field field-search">
          <label>Search expense</label>
          <input
            value={filters.search}
            onChange={(e) => updateFilter({ search: e.target.value })}
            placeholder="Search title or notes..."
          />
        </div>
        {selected.size > 0 && (
          <button type="button" className="btn btn-danger" onClick={removeSelected}>
            <IconTrash /> Delete ({selected.size})
          </button>
        )}
      </div>

      <div className="card expenses-table-card">
        <div className="table-wrap">
          <table className="expenses-table">
            <thead>
              <tr>
                <th className="sticky-col sticky-col-check">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    ref={(el) => { if (el) el.indeterminate = somePageSelected && !allPageSelected }}
                    onChange={toggleSelectAll}
                    aria-label="Select all on page"
                  />
                </th>
                <th className="sticky-col sticky-col-name">Title</th>
                <th>Expense #</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Date</th>
                <th>Notes</th>
                <th className="sticky-col sticky-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state"><span className="spinner" /></div>
                  </td>
                </tr>
              ) : data.rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <strong>No expenses found</strong>
                      {wallet.balance > 0
                        ? 'Add an expense to deduct from your available balance.'
                        : 'Add balance first, then record expenses to deduct from it.'}
                    </div>
                  </td>
                </tr>
              ) : (
                data.rows.map((expense) => (
                  <tr key={expense.id} className={selected.has(expense.id) ? 'row-selected' : ''}>
                    <td className="sticky-col sticky-col-check">
                      <input
                        type="checkbox"
                        checked={selected.has(expense.id)}
                        onChange={() => toggleSelect(expense.id)}
                        aria-label={`Select ${expense.title}`}
                      />
                    </td>
                    <td className="sticky-col sticky-col-name">
                      <strong>{expense.title}</strong>
                    </td>
                    <td>#{expense.id}</td>
                    <td className="num out">{money(expense.amount)}</td>
                    <td>{expense.method || '—'}</td>
                    <td>{fmtDate(expense.created_at)}</td>
                    <td className="notes-cell">{expense.notes || '—'}</td>
                    <td className="sticky-col sticky-col-actions">
                      <div className="row-actions">
                        <button type="button" className="icon-btn" title="Edit" onClick={() => openEdit(expense)}>
                          <IconEdit />
                        </button>
                        <button type="button" className="icon-btn danger" title="Delete" onClick={() => remove(expense)}>
                          <IconTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={data.total}
          onChange={setPage}
        />
      </div>

      <Drawer
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit Expense · #${editing.id}` : 'Add Expense'}
        footer={(
          <button type="submit" form="expense-form" className="btn btn-primary" disabled={saving}>
            {saving ? <span className="spinner" /> : (editing ? 'Save changes' : 'Add expense')}
          </button>
        )}
      >
        <form id="expense-form" className="form-grid form-grid-one" onSubmit={saveExpense}>
          <div className="field">
            <label>Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Shop rent, electricity"
              required
            />
          </div>
          {!editing && (
            <div className="field">
              <label>Amount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0"
                required
              />
              <p className="hint">Will be deducted from available balance ({money(wallet.balance)}).</p>
            </div>
          )}
          <div className="field">
            <label>Method</label>
            <select
              value={form.method}
              onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
            >
              <option value="Cash">Cash</option>
              <option value="Bank">Bank</option>
              <option value="JazzCash">JazzCash</option>
              <option value="EasyPaisa">EasyPaisa</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="field">
            <label>Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional notes"
            />
          </div>
        </form>
      </Drawer>

      <Drawer
        open={balanceOpen}
        onClose={() => setBalanceOpen(false)}
        title="Add Balance"
        footer={(
          <button type="submit" form="balance-form" className="btn btn-primary" disabled={savingBalance}>
            {savingBalance ? <span className="spinner" /> : 'Add balance'}
          </button>
        )}
      >
        <form id="balance-form" className="form-grid form-grid-one" onSubmit={saveBalance}>
          <div className="field">
            <label>Amount</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={balanceForm.amount}
              onChange={(e) => setBalanceForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0"
              required
              autoFocus
            />
          </div>
          <div className="field">
            <label>Method</label>
            <select
              value={balanceForm.method}
              onChange={(e) => setBalanceForm((f) => ({ ...f, method: e.target.value }))}
            >
              <option value="Cash">Cash</option>
              <option value="Bank">Bank</option>
              <option value="JazzCash">JazzCash</option>
              <option value="EasyPaisa">EasyPaisa</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="field">
            <label>Description</label>
            <input
              value={balanceForm.description}
              onChange={(e) => setBalanceForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Cash for shop expenses"
            />
          </div>
          <p className="hint">Current available balance: {money(wallet.balance)}</p>
        </form>
      </Drawer>
    </div>
  )
}

export default Expenses

import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import XLSX from 'xlsx'
import { app, BrowserWindow, clipboard, dialog, shell } from 'electron'

let db

const nowISO = () => {
  return new Date().toISOString()
}

const num = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const escapeHtml = (value = '') => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const formatPdfDate = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const formatPdfMoney = (value) => {
  const amount = num(value)
  return `Rs ${amount.toLocaleString('en-PK', {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })}`
}

const ledgerTypeLabel = (type) => {
  if (type === 'debit') return 'Not Paid'
  if (type === 'payable') return 'To Pay'
  return 'Paid'
}

/* ---------------------------------------------------------------- setup */

const resolveDbPath = () => {
  const canonical = path.join(app.getPath('userData'), 'pos.db')
  const appData = app.getPath('appData')
  const legacy = [
    path.join(appData, 'Alizeh Foam', 'pos.db'),
    path.join(appData, 'shop-pos', 'pos.db'),
    canonical
  ].filter((p) => fs.existsSync(p))

  if (!legacy.length) return canonical

  const newest = legacy.reduce((best, p) =>
    (fs.statSync(p).mtimeMs > fs.statSync(best).mtimeMs ? p : best))

  if (newest !== canonical) {
    fs.mkdirSync(path.dirname(canonical), { recursive: true })
    fs.copyFileSync(newest, canonical)
  }
  return canonical
}

const init = () => {
  const dbPath = resolveDbPath()
  db = new Database(dbPath)
  db.pragma('journal_mode = DELETE')

  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      image       TEXT,
      quantity    INTEGER NOT NULL DEFAULT 0,
      cost        REAL    NOT NULL DEFAULT 0,
      status      TEXT    NOT NULL DEFAULT 'in_stock',
      created_at  TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id    INTEGER,
      product_name  TEXT,
      quantity      INTEGER NOT NULL DEFAULT 1,
      price         REAL    NOT NULL DEFAULT 0,
      margin        REAL    NOT NULL DEFAULT 0,
      customer_id   INTEGER,
      paid_amount   REAL    NOT NULL DEFAULT 0,
      status        TEXT    NOT NULL DEFAULT 'DONE',
      created_at    TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      phone       TEXT,
      address     TEXT,
      notes       TEXT,
      created_at  TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_ledger (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id  INTEGER NOT NULL,
      order_id     INTEGER,
      type         TEXT    NOT NULL CHECK (type IN ('debit', 'credit', 'payable')),
      amount       REAL    NOT NULL DEFAULT 0,
      description  TEXT,
      method       TEXT,
      created_at   TEXT    NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
  `)

  migrateOrdersSchema()
  migrateOrderArchive()
  migrateOrderCustomerFields()
  migrateOrderItemsSchema()
  migrateCustomerLedgerTypes()
  migrateProductsSchema()
  migrateAppUser()
  return dbPath
}

const migrateAppUser = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_user (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      name          TEXT    NOT NULL,
      email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT    NOT NULL,
      created_at    TEXT    NOT NULL
    );
  `)
}

const hasAppUser = () => {
  return !!db.prepare('SELECT 1 FROM app_user WHERE id = 1').get()
}

const getAppUser = () => {
  return db.prepare('SELECT id, name, email, password_hash, created_at FROM app_user WHERE id = 1').get()
}

const createAppUser = ({ name, email, passwordHash }) => {
  if (hasAppUser()) throw new Error('Account already created')

  db.prepare(
    `INSERT INTO app_user (id, name, email, password_hash, created_at)
     VALUES (1, @name, @email, @password_hash, @created_at)`
  ).run({
    name,
    email,
    password_hash: passwordHash,
    created_at: nowISO()
  })

  return { name, email }
}

/* ------------------------------------------------------------- products */

const getProductById = (id) => {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id)
}

const listProductsBrief = () => {
  return db
    .prepare('SELECT id, name, cost, quantity, status FROM products ORDER BY name')
    .all()
}

const getProducts = (filters = {}) => {
  const search = filters.search || ''
  const status = filters.status || ''
  const costOp = filters.costOp || ''
  const costValue = filters.costValue
  const page = Math.max(1, num(filters.page, 1))
  const pageSize = Math.max(1, num(filters.pageSize, 25))

  const where = []
  const params = {}

  if (search) {
    where.push('name LIKE @search')
    params.search = `%${search}%`
  }
  if (status) {
    where.push('status = @status')
    params.status = status
  }
  if (costOp && costValue !== '' && costValue !== null && costValue !== undefined && Number.isFinite(Number(costValue))) {
    const op = costOp === 'gt' ? '>' : costOp === 'lt' ? '<' : '='
    where.push(`cost ${op} @costValue`)
    params.costValue = Number(costValue)
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) AS c FROM products ${whereSql}`).get(params).c
  const rows = db
    .prepare(`SELECT * FROM products ${whereSql} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize })

  return { rows, total, page, pageSize }
}

const createProduct = (data) => {
  const info = db
    .prepare(
      `INSERT INTO products (name, image, quantity, cost, status, created_at)
       VALUES (@name, @image, @quantity, @cost, @status, @created_at)`
    )
    .run({
      name: data.name || 'Unnamed product',
      image: data.image || null,
      quantity: num(data.quantity),
      cost: num(data.cost),
      status: data.status === 'out_of_stock' ? 'out_of_stock' : 'in_stock',
      created_at: nowISO()
    })
  return getProductById(info.lastInsertRowid)
}

const updateProduct = ({ id, data }) => {
  db.prepare(
    `UPDATE products
     SET name = @name, image = @image, quantity = @quantity,
         cost = @cost, status = @status
     WHERE id = @id`
  ).run({
    id,
    name: data.name || 'Unnamed product',
    image: data.image || null,
    quantity: num(data.quantity),
    cost: num(data.cost),
    status: data.status === 'out_of_stock' ? 'out_of_stock' : 'in_stock'
  })
  return getProductById(id)
}

const deleteProduct = (id) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(id)
  return { ok: true }
}

const deleteProducts = (ids = []) => {
  const list = [...new Set(ids.map((id) => Number(id)).filter((id) => id > 0))]
  if (!list.length) return { ok: true, count: 0 }
  const placeholders = list.map(() => '?').join(', ')
  const result = db.prepare(`DELETE FROM products WHERE id IN (${placeholders})`).run(...list)
  return { ok: true, count: result.changes }
}

/* --------------------------------------------------------------- orders */

const isUnset = (v) => {
  return v === '' || v === null || v === undefined
}

const migrateOrdersSchema = () => {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name)
  if (!cols.includes('product_id')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS order_items (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id      INTEGER NOT NULL,
        product_id    INTEGER,
        product_name  TEXT,
        quantity      INTEGER NOT NULL DEFAULT 1,
        total_price   REAL    NOT NULL DEFAULT 0,
        unit_cost     REAL    NOT NULL DEFAULT 0,
        profit        REAL    NOT NULL DEFAULT 0,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      );
    `)
    return
  }

  db.exec(`
    CREATE TABLE orders_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      status      TEXT NOT NULL DEFAULT 'DONE',
      created_at  TEXT NOT NULL
    );
    CREATE TABLE order_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id      INTEGER NOT NULL,
      product_id    INTEGER,
      product_name  TEXT,
      quantity      INTEGER NOT NULL DEFAULT 1,
      total_price   REAL    NOT NULL DEFAULT 0,
      unit_cost     REAL    NOT NULL DEFAULT 0,
      profit        REAL    NOT NULL DEFAULT 0,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
  `)

  const legacy = db.prepare('SELECT * FROM orders').all()
  const insOrder = db.prepare('INSERT INTO orders_new (id, status, created_at) VALUES (?, ?, ?)')
  const insItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, quantity, total_price, unit_cost, profit)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )

  db.transaction(() => {
    for (const row of legacy) {
      const qty = num(row.quantity, 1)
      const unitPrice = num(row.price)
      const unitMargin = num(row.margin)
      insOrder.run(row.id, row.status, row.created_at)
      insItem.run(
        row.id, row.product_id, row.product_name, qty,
        unitPrice * qty,
        unitPrice - unitMargin,
        unitMargin * qty
      )
    }
  })()

  db.exec('DROP TABLE orders; ALTER TABLE orders_new RENAME TO orders;')
}

const migrateOrderArchive = () => {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name)
  if (!cols.includes('isArchive')) {
    db.exec('ALTER TABLE orders ADD COLUMN isArchive INTEGER NOT NULL DEFAULT 0')
  }
}

const migrateOrderCustomerFields = () => {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name)
  if (!cols.includes('customer_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_id INTEGER')
  }
  if (!cols.includes('paid_amount')) {
    db.exec('ALTER TABLE orders ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0')
  }
}

const migrateOrderItemsSchema = () => {
  const cols = db.prepare('PRAGMA table_info(order_items)').all().map((c) => c.name)
  if (!cols.length) return

  if (cols.includes('total_price') && cols.includes('unit_cost') && cols.includes('profit') && !cols.includes('margin')) {
    return
  }

  if (!cols.includes('price')) return

  db.exec(`
    CREATE TABLE order_items_new (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id      INTEGER NOT NULL,
      product_id    INTEGER,
      product_name  TEXT,
      quantity      INTEGER NOT NULL DEFAULT 1,
      total_price   REAL    NOT NULL DEFAULT 0,
      unit_cost     REAL    NOT NULL DEFAULT 0,
      profit        REAL    NOT NULL DEFAULT 0,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    INSERT INTO order_items_new (id, order_id, product_id, product_name, quantity, total_price, unit_cost, profit)
    SELECT id, order_id, product_id, product_name, quantity,
           price * quantity,
           price - margin,
           margin * quantity
    FROM order_items;
    DROP TABLE order_items;
    ALTER TABLE order_items_new RENAME TO order_items;
  `)
}

const migrateCustomerLedgerTypes = () => {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'customer_ledger'").get()
  if (!table?.sql || table.sql.includes("'payable'")) return

  db.exec(`
    CREATE TABLE customer_ledger_new (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id  INTEGER NOT NULL,
      order_id     INTEGER,
      type         TEXT    NOT NULL CHECK (type IN ('debit', 'credit', 'payable')),
      amount       REAL    NOT NULL DEFAULT 0,
      description  TEXT,
      method       TEXT,
      created_at   TEXT    NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
    INSERT INTO customer_ledger_new (id, customer_id, order_id, type, amount, description, method, created_at)
    SELECT id, customer_id, order_id, type, amount, description, method, created_at
    FROM customer_ledger;
    DROP TABLE customer_ledger;
    ALTER TABLE customer_ledger_new RENAME TO customer_ledger;
  `)
}

const migrateProductsSchema = () => {
  const cols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name)
  if (!cols.length) return

  const hasNetPrice = cols.includes('net_price')
  const hasCost = cols.includes('cost')
  const hasMargin = cols.includes('margin')

  if (hasCost && !hasNetPrice && !hasMargin) return

  const costSource = hasCost ? 'cost' : 'net_price'
  db.exec(`
    CREATE TABLE products_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      image       TEXT,
      quantity    INTEGER NOT NULL DEFAULT 0,
      cost        REAL    NOT NULL DEFAULT 0,
      status      TEXT    NOT NULL DEFAULT 'in_stock',
      created_at  TEXT    NOT NULL
    );
    INSERT INTO products_new (id, name, image, quantity, cost, status, created_at)
    SELECT id, name, image, quantity, ${costSource}, status, created_at FROM products;
    DROP TABLE products;
    ALTER TABLE products_new RENAME TO products;
  `)
}

const inventoryTotals = (items) => {
  const totals = new Map()
  for (const item of items) {
    const productId = item.product_id ? num(item.product_id) : null
    if (!productId) continue
    totals.set(productId, (totals.get(productId) || 0) + num(item.quantity, 1))
  }
  return totals
}

const adjustInventory = (items, sign) => {
  const totals = inventoryTotals(items)
  const getProduct = db.prepare('SELECT id, name, quantity, status FROM products WHERE id = ?')
  const update = db.prepare('UPDATE products SET quantity = @quantity, status = @status WHERE id = @id')

  for (const [productId, qty] of totals) {
    const product = getProduct.get(productId)
    if (!product) continue

    if (sign < 0 && qty > num(product.quantity)) {
      throw new Error(`Not enough stock for ${product.name}. Available: ${num(product.quantity)}`)
    }
  }

  for (const [productId, qty] of totals) {
    const product = getProduct.get(productId)
    if (!product) continue
    const newQty = Math.max(0, num(product.quantity) + sign * qty)
    const newStatus = newQty <= 0 ? 'out_of_stock' : 'in_stock'
    update.run({ id: productId, quantity: newQty, status: newStatus })
  }
}

const restoreInventory = (items) => {
  adjustInventory(items, 1)
}

const deductInventory = (items) => {
  adjustInventory(items, -1)
}

const resolveItemPricing = (data, existingItem = null) => {
  const productId = data.product_id ? num(data.product_id) : null
  const product = productId ? getProductById(productId) : null

  let productName = data.product_name
  const quantity = num(data.quantity, 1)
  let totalPrice = data.total_price
  let unitCost = data.unit_cost

  if (product && !productName) productName = product.name

  if (isUnset(unitCost) && existingItem) {
    unitCost = existingItem.unit_cost
  } else if (isUnset(unitCost) && product) {
    unitCost = product.cost
  } else {
    unitCost = num(unitCost)
  }

  if (isUnset(totalPrice) || num(totalPrice) <= 0) {
    throw new Error(`Total price is required for ${productName || 'each product'}`)
  }
  totalPrice = num(totalPrice)

  const profit = totalPrice - quantity * unitCost

  return {
    product_id: productId,
    product_name: productName || '',
    quantity,
    total_price: totalPrice,
    unit_cost: unitCost,
    profit
  }
}

const mapOrderItem = (row) => {
  return {
    id: row.id,
    product_id: row.product_id,
    product_name: row.product_name,
    quantity: num(row.quantity),
    total_price: num(row.total_price),
    unit_cost: num(row.unit_cost),
    profit: num(row.profit)
  }
}

const attachItems = (order) => {
  const items = db
    .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
    .all(order.id)
    .map(mapOrderItem)
  return { ...order, items }
}

const getOrderById = (id) => {
  const order = db
    .prepare(
      `SELECT o.id, o.status, o.created_at, o.customer_id, o.paid_amount, c.name AS customer_name
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`
    )
    .get(id)
  if (!order) return null
  return attachItems(order)
}

const normalizeOrderItems = (data) => {
  if (Array.isArray(data.items) && data.items.length) return data.items
  if (data.product_id || data.product_name) {
    return [{
      product_id: data.product_id,
      product_name: data.product_name,
      quantity: data.quantity,
      total_price: data.total_price,
      unit_cost: data.unit_cost
    }]
  }
  return []
}

/* ------------------------------------------------------------- customers */

const customerSummarySelect = `
  SELECT c.id, c.name, c.phone, c.address, c.notes, c.created_at,
         COALESCE(SUM(CASE WHEN l.type = 'debit' THEN l.amount ELSE 0 END), 0) AS total_purchased,
         COALESCE(SUM(CASE WHEN l.type = 'credit' THEN l.amount ELSE 0 END), 0) AS total_paid,
         COALESCE(SUM(CASE WHEN l.type = 'payable' THEN l.amount ELSE 0 END), 0) AS total_payable,
         0 AS balance,
         MAX(l.created_at) AS last_transaction
  FROM customers c
  LEFT JOIN customer_ledger l ON l.customer_id = c.id
`

const listCustomers = (filters = {}) => {
  const search = String(filters.search || '').trim()
  const balance = filters.balance || ''
  const page = Math.max(1, num(filters.page, 1))
  const pageSize = Math.max(1, num(filters.pageSize, 25))
  const where = []
  const params = {}

  if (search) {
    where.push('(c.name LIKE @search OR c.phone LIKE @search)')
    params.search = `%${search}%`
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const baseSql = `${customerSummarySelect} ${whereSql} GROUP BY c.id`
  const filteredRows = db
    .prepare(`${baseSql} ORDER BY c.id DESC`)
    .all(params)
    .map(withComputedCustomerBalance)
    .filter((customer) => {
      if (balance === 'pending') return customer.balance > 0
      if (balance === 'payable') return customer.balance < 0
      if (balance === 'clear') return customer.balance === 0
      return true
    })
    .sort((a, b) => (b.balance - a.balance) || (b.id - a.id))
  const total = filteredRows.length
  const rows = filteredRows.slice((page - 1) * pageSize, page * pageSize)

  return { rows, total, page, pageSize }
}

const listCustomersBrief = () => {
  return db.prepare('SELECT id, name, phone FROM customers ORDER BY name').all()
}

const getCustomerSummary = (id) => {
  return withComputedCustomerBalance(db.prepare(`${customerSummarySelect} WHERE c.id = ? GROUP BY c.id`).get(id))
}

const ledgerWithRunningBalance = (rows) => {
  let running = 0
  return rows.map((row) => {
    if (row.type === 'debit') {
      running += num(row.amount)
    } else if (row.type === 'payable') {
      running -= num(row.amount)
    } else if (running > 0) {
      running = Math.max(0, running - num(row.amount))
    }
    return { ...row, running_balance: running }
  })
}

const withComputedCustomerBalance = (customer) => {
  if (!customer) return null
  const rows = db
    .prepare('SELECT type, amount FROM customer_ledger WHERE customer_id = ? ORDER BY datetime(created_at), id')
    .all(customer.id)
  const balancedRows = ledgerWithRunningBalance(rows)
  return {
    ...customer,
    balance: balancedRows.length ? balancedRows[balancedRows.length - 1].running_balance : 0
  }
}

const getCustomerKhata = (id) => {
  const customer = getCustomerSummary(id)
  if (!customer) return null
  const rows = db
    .prepare('SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY datetime(created_at), id')
    .all(id)
  return { customer, rows: ledgerWithRunningBalance(rows) }
}

const addLedgerEntry = ({ customer_id, order_id = null, type, amount, description = '', method = '', created_at = nowISO() }) => {
  const value = num(amount)
  if (!customer_id) throw new Error('Select a customer')
  if (!['debit', 'credit', 'payable'].includes(type)) throw new Error('Invalid ledger entry type')
  if (value <= 0) throw new Error('Amount must be greater than 0')

  const info = db.prepare(
    `INSERT INTO customer_ledger (customer_id, order_id, type, amount, description, method, created_at)
     VALUES (@customer_id, @order_id, @type, @amount, @description, @method, @created_at)`
  ).run({
    customer_id,
    order_id,
    type,
    amount: value,
    description,
    method,
    created_at
  })
  return db.prepare('SELECT * FROM customer_ledger WHERE id = ?').get(info.lastInsertRowid)
}

const createCustomer = (data) => {
  const name = String(data.name || '').trim()
  if (!name) throw new Error('Customer name is required')

  const info = db.prepare(
    `INSERT INTO customers (name, phone, address, notes, created_at)
     VALUES (@name, @phone, @address, @notes, @created_at)`
  ).run({
    name,
    phone: String(data.phone || '').trim(),
    address: String(data.address || '').trim(),
    notes: String(data.notes || '').trim(),
    created_at: nowISO()
  })

  const id = info.lastInsertRowid
  const opening = num(data.opening_balance)
  if (opening > 0) {
    addLedgerEntry({
      customer_id: id,
      type: 'debit',
      amount: opening,
      description: 'Opening balance'
    })
  }
  return getCustomerSummary(id)
}

const updateCustomer = ({ id, data }) => {
  const name = String(data.name || '').trim()
  if (!name) throw new Error('Customer name is required')

  db.prepare(
    `UPDATE customers
     SET name = @name, phone = @phone, address = @address, notes = @notes
     WHERE id = @id`
  ).run({
    id,
    name,
    phone: String(data.phone || '').trim(),
    address: String(data.address || '').trim(),
    notes: String(data.notes || '').trim()
  })
  return getCustomerSummary(id)
}

const deleteCustomer = (id) => {
  db.prepare('UPDATE orders SET customer_id = NULL, paid_amount = 0 WHERE customer_id = ?').run(id)
  db.prepare('DELETE FROM customer_ledger WHERE customer_id = ?').run(id)
  const result = db.prepare('DELETE FROM customers WHERE id = ?').run(id)
  return { ok: true, count: result.changes }
}

const deleteCustomers = (ids = []) => {
  const list = [...new Set(ids.map((id) => Number(id)).filter((id) => id > 0))]
  if (!list.length) return { ok: true, count: 0 }
  const placeholders = list.map(() => '?').join(', ')
  db.prepare(`UPDATE orders SET customer_id = NULL, paid_amount = 0 WHERE customer_id IN (${placeholders})`).run(...list)
  db.prepare(`DELETE FROM customer_ledger WHERE customer_id IN (${placeholders})`).run(...list)
  const result = db.prepare(`DELETE FROM customers WHERE id IN (${placeholders})`).run(...list)
  return { ok: true, count: result.changes }
}

const deleteCustomerLedgerEntries = ({ id, entryIds = [] }) => {
  const customerId = Number(id)
  const list = [...new Set(entryIds.map((entryId) => Number(entryId)).filter((entryId) => entryId > 0))]
  if (!customerId || !list.length) return { ok: true, count: 0 }
  const placeholders = list.map(() => '?').join(', ')
  const result = db
    .prepare(`DELETE FROM customer_ledger WHERE customer_id = ? AND id IN (${placeholders})`)
    .run(customerId, ...list)
  return { ok: true, count: result.changes }
}

const receiveCustomerPayment = ({ id, data }) => {
  return addLedgerEntry({
    customer_id: id,
    type: 'credit',
    amount: data.amount,
    description: data.description || 'Payment received',
    method: data.method || 'Cash',
    created_at: data.created_at || nowISO()
  })
}

const addCustomerCharge = ({ id, data }) => {
  return addLedgerEntry({
    customer_id: id,
    type: 'debit',
    amount: data.amount,
    description: data.description || 'Manual khata entry',
    method: data.method || '',
    created_at: data.created_at || nowISO()
  })
}

const addCustomerPayable = ({ id, data }) => {
  return addLedgerEntry({
    customer_id: id,
    type: 'payable',
    amount: data.amount,
    description: data.description || 'Amount payable to customer',
    method: data.method || '',
    created_at: data.created_at || nowISO()
  })
}

const replaceOrderLedger = ({ orderId, customerId, status, paidAmount, items }) => {
  db.prepare('DELETE FROM customer_ledger WHERE order_id = ?').run(orderId)
  if (status !== 'DONE' || !customerId) return

  const total = items.reduce((sum, item) => sum + num(item.total_price), 0)
  if (total <= 0) return

  addLedgerEntry({
    customer_id: customerId,
    order_id: orderId,
    type: 'debit',
    amount: total,
    description: `Order #${orderId}`
  })

  const paid = Math.min(Math.max(num(paidAmount), 0), total)
  if (paid > 0) {
    addLedgerEntry({
      customer_id: customerId,
      order_id: orderId,
      type: 'credit',
      amount: paid,
      description: `Payment for order #${orderId}`,
      method: 'Cash'
    })
  }
}

const getOrders = (filters = {}) => {
  const page = Math.max(1, num(filters.page, 1))
  const pageSize = Math.max(1, num(filters.pageSize, 25))

  const where = ['o.isArchive = 0']
  const params = {}

  if (filters.orderId) {
    where.push('o.id = @orderId')
    params.orderId = num(filters.orderId)
  }
  if (filters.productId) {
    where.push(`EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.product_id = @productId)`)
    params.productId = num(filters.productId)
  }
  if (filters.productName) {
    where.push(`EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.product_name LIKE @productName)`)
    params.productName = `%${filters.productName}%`
  }
  if (filters.status) {
    where.push('o.status = @status')
    params.status = filters.status
  }
  if (filters.startDate) {
    where.push('date(o.created_at) >= date(@startDate)')
    params.startDate = filters.startDate
  }
  if (filters.endDate) {
    where.push('date(o.created_at) <= date(@endDate)')
    params.endDate = filters.endDate
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) AS c FROM orders o ${whereSql}`).get(params).c
  const orders = db
    .prepare(
      `SELECT o.id, o.status, o.created_at, o.customer_id, o.paid_amount, c.name AS customer_name
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       ${whereSql}
       ORDER BY o.id DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize })

  const rows = orders.map(attachItems)
  return { rows, total, page, pageSize }
}

const createOrder = (data) => {
  const items = normalizeOrderItems(data)
  if (!items.length) throw new Error('Order must include at least one product')

  const status = data.status === 'CANCELLED' ? 'CANCELLED' : 'DONE'
  const created_at = data.created_at || nowISO()
  const customer_id = data.customer_id ? num(data.customer_id) : null
  const paid_amount = num(data.paid_amount)

  const insertOrder = db.prepare(
    `INSERT INTO orders (status, created_at, isArchive, customer_id, paid_amount)
     VALUES (@status, @created_at, 0, @customer_id, @paid_amount)`
  )
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, quantity, total_price, unit_cost, profit)
     VALUES (@order_id, @product_id, @product_name, @quantity, @total_price, @unit_cost, @profit)`
  )

  const orderId = db.transaction(() => {
    const info = insertOrder.run({ status, created_at, customer_id, paid_amount })
    const id = info.lastInsertRowid
    const resolved = items.map((raw) => resolveItemPricing(raw))
    for (const item of resolved) {
      insertItem.run({ order_id: id, ...item })
    }
    if (status === 'DONE') deductInventory(resolved)
    replaceOrderLedger({ orderId: id, customerId: customer_id, status, paidAmount: paid_amount, items: resolved })
    return id
  })()

  return getOrderById(orderId)
}

const updateOrder = ({ id, data }) => {
  const items = normalizeOrderItems(data)
  if (!items.length) throw new Error('Order must include at least one product')

  const status = data.status === 'CANCELLED' ? 'CANCELLED' : 'DONE'
  const customer_id = data.customer_id ? num(data.customer_id) : null
  const paid_amount = num(data.paid_amount)
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, quantity, total_price, unit_cost, profit)
     VALUES (@order_id, @product_id, @product_name, @quantity, @total_price, @unit_cost, @profit)`
  )
  const existingOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(id)
  const existingItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id)
  const existingByProduct = new Map(existingItems.map((i) => [i.product_id, i]))

  db.transaction(() => {
    if (existingOrder?.status === 'DONE') restoreInventory(existingItems)

    db.prepare('UPDATE orders SET status = @status, customer_id = @customer_id, paid_amount = @paid_amount WHERE id = @id')
      .run({ id, status, customer_id, paid_amount })
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id)

    const resolved = items.map((raw) => {
      const productId = raw.product_id ? num(raw.product_id) : null
      const existing = productId ? existingByProduct.get(productId) : null
      return resolveItemPricing(raw, existing)
    })
    for (const item of resolved) {
      insertItem.run({ order_id: id, ...item })
    }
    if (status === 'DONE') deductInventory(resolved)
    replaceOrderLedger({ orderId: id, customerId: customer_id, status, paidAmount: paid_amount, items: resolved })
  })()

  return getOrderById(id)
}

const deleteOrder = (id) => {
  const order = db.prepare('SELECT status FROM orders WHERE id = ? AND isArchive = 0').get(id)
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id)

  db.transaction(() => {
    if (order?.status === 'DONE') restoreInventory(items)
    db.prepare('DELETE FROM customer_ledger WHERE order_id = ?').run(id)
    db.prepare('UPDATE orders SET isArchive = 1 WHERE id = ? AND isArchive = 0').run(id)
  })()

  return { ok: true, count: order ? 1 : 0 }
}

const deleteOrders = (ids = []) => {
  const list = [...new Set(ids.map((id) => Number(id)).filter((id) => id > 0))]
  if (!list.length) return { ok: true, count: 0 }
  const placeholders = list.map(() => '?').join(', ')

  let count = 0
  db.transaction(() => {
    for (const id of list) {
      const order = db.prepare('SELECT status FROM orders WHERE id = ? AND isArchive = 0').get(id)
      if (!order) continue
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id)
      if (order.status === 'DONE') restoreInventory(items)
      db.prepare('DELETE FROM customer_ledger WHERE order_id = ?').run(id)
      const result = db.prepare('UPDATE orders SET isArchive = 1 WHERE isArchive = 0 AND id = ?').run(id)
      count += result.changes
    }
  })()

  return { ok: true, count }
}

/* ------------------------------------------------------------ dashboard */
// Only DONE orders count toward sales / profit / items sold.

const parseIsoDate = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

const toIsoDate = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const daysInRange = (start, end) => {
  const a = parseIsoDate(start)
  const b = parseIsoDate(end)
  return Math.round((b - a) / 86400000) + 1
}

const addDaysIso = (iso, n) => {
  const d = parseIsoDate(iso)
  d.setDate(d.getDate() + n)
  return toIsoDate(d)
}

const previousPeriodDates = (start, end) => {
  const days = daysInRange(start, end)
  const prevEnd = addDaysIso(start, -1)
  const prevStart = addDaysIso(prevEnd, -(days - 1))
  return { startDate: prevStart, endDate: prevEnd, days }
}

const fillSeriesGaps = (rows, startDate, endDate) => {
  if (!startDate || !endDate) return rows
  const byDate = {}
  rows.forEach((r) => { byDate[r.date] = r })
  const result = []
  for (let d = startDate; d <= endDate; d = addDaysIso(d, 1)) {
    result.push(byDate[d] || { date: d, sales: 0, profit: 0, items: 0 })
  }
  return result
}

const normalizeProductIds = (filters = {}) => {
  const raw = filters.productIds
  if (raw == null || raw === '') return []
  const list = Array.isArray(raw) ? raw : [raw]
  return [...new Set(list.map((id) => Number(id)).filter((id) => id > 0))]
}

const productIdsFilter = (filters, params, alias = 'i') => {
  const ids = normalizeProductIds(filters)
  if (!ids.length) return ''
  const placeholders = ids.map((_, idx) => `@pid${idx}`).join(', ')
  ids.forEach((id, idx) => { params[`pid${idx}`] = id })
  return ` AND ${alias}.product_id IN (${placeholders})`
}

const dashboardBaseWhere = (filters, params) => {
  const where = ["o.status = 'DONE'", 'o.isArchive = 0']

  if (filters.startDate) {
    where.push('date(o.created_at) >= date(@startDate)')
    params.startDate = filters.startDate
  }
  if (filters.endDate) {
    where.push('date(o.created_at) <= date(@endDate)')
    params.endDate = filters.endDate
  }

  return where;
}

const getOrderTotalsForRange = (startDate, endDate, filters = {}) => {
  const params = { startDate, endDate }
  const where = dashboardBaseWhere({ ...filters, startDate, endDate }, params)
  const productFilter = productIdsFilter(filters, params)

  const whereSql = 'WHERE ' + where.join(' AND ') + productFilter
  const row = db
    .prepare(
      `SELECT SUM(i.total_price) AS sales,
              SUM(i.profit)      AS profit,
              SUM(i.quantity)    AS items
       FROM order_items i
       JOIN orders o ON o.id = i.order_id
       ${whereSql}`
    )
    .get(params)

  return {
    sales: num(row.sales),
    profit: num(row.profit),
    items: num(row.items)
  }
}

const getDashboard = (filters = {}) => {
  const params = {}
  const where = dashboardBaseWhere(filters, params)
  const productFilter = productIdsFilter(filters, params)
  const whereSql = 'WHERE ' + where.join(' AND ') + productFilter
  const series = db
    .prepare(
      `SELECT date(o.created_at) AS date,
              SUM(i.total_price) AS sales,
              SUM(i.profit)      AS profit,
              SUM(i.quantity)    AS items
       FROM order_items i
       JOIN orders o ON o.id = i.order_id
       ${whereSql}
       GROUP BY date(o.created_at)
       ORDER BY date(o.created_at)`
    )
    .all(params)
    .map((r) => ({
      date: r.date,
      sales: num(r.sales),
      profit: num(r.profit),
      items: num(r.items)
    }))

  const filledSeries = fillSeriesGaps(series, filters.startDate, filters.endDate)

  const totals = series.reduce(
    (a, r) => ({
      sales: a.sales + r.sales,
      profit: a.profit + r.profit,
      items: a.items + r.items
    }),
    { sales: 0, profit: 0, items: 0 }
  )

  let previousTotals = { sales: 0, profit: 0, items: 0 }
  let previousPeriod = null

  if (filters.startDate && filters.endDate) {
    previousPeriod = previousPeriodDates(filters.startDate, filters.endDate)
    previousTotals = getOrderTotalsForRange(previousPeriod.startDate, previousPeriod.endDate, filters)
  }

  return { series: filledSeries, totals, previousTotals, previousPeriod }
}

/* --------------------------------------------------------- excel import/export */

const exportProducts = async () => {
  const rows = db
    .prepare(
      `SELECT id AS product_number, name, quantity, cost, status, created_at
       FROM products ORDER BY id`
    )
    .all()
  return writeSheet(rows, 'Products', 'products.xlsx')
}

const exportOrders = async () => {
  const rows = db
    .prepare(
      `SELECT o.id AS order_number, i.product_id, i.product_name, i.quantity,
              i.total_price, i.unit_cost, i.profit, o.status, o.created_at
       FROM orders o
       JOIN order_items i ON i.order_id = o.id
       WHERE o.isArchive = 0
       ORDER BY o.id, i.id`
    )
    .all()
  return writeSheet(rows, 'Orders', 'orders.xlsx')
}

const renderKhataPdf = (customer, rows) => {
  const totalAmount = rows.length ? rows[rows.length - 1].running_balance : customer.balance
  const totalLabel = totalAmount > 0 ? 'Total Customer Owes' : totalAmount < 0 ? 'Total To Pay Customer' : 'Total Amount'
  const totalClass = totalAmount > 0 ? 'owes' : totalAmount < 0 ? 'payable' : 'clear'
  const tableRows = rows.length
    ? rows.map((row) => `
      <tr>
        <td>${escapeHtml(formatPdfDate(row.created_at))}</td>
        <td><span class="badge ${row.type === 'debit' ? 'out' : row.type === 'payable' ? 'payable' : 'in'}">${escapeHtml(ledgerTypeLabel(row.type))}</span></td>
        <td>${escapeHtml(row.description || '-')}</td>
        <td class="num">${row.type === 'debit' ? escapeHtml(formatPdfMoney(row.amount)) : '-'}</td>
        <td class="num">${row.type === 'credit' ? escapeHtml(formatPdfMoney(row.amount)) : '-'}</td>
        <td class="num">${row.type === 'payable' ? escapeHtml(formatPdfMoney(row.amount)) : '-'}</td>
        <td class="num strong">${escapeHtml(formatPdfMoney(row.running_balance))}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="7" class="empty">No khata entries selected.</td></tr>'

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(customer.name)} . khata</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; color: #1a2230; font-family: Arial, Helvetica, sans-serif; }
    h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: -0.2px; }
    .meta { margin-bottom: 22px; color: #5c6b7e; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 10px 12px; color: #8a97a8; text-transform: uppercase; letter-spacing: 0.5px; background: #fbfcfd; border-top: 1px solid #e4e7ec; border-bottom: 1px solid #e4e7ec; }
    td { padding: 11px 12px; border-bottom: 1px solid #e4e7ec; vertical-align: middle; }
    th:not(:nth-child(3)), td:not(:nth-child(3)) { text-align: center; }
    .num { font-family: "SF Mono", Consolas, monospace; white-space: nowrap; }
    .strong { font-weight: 700; }
    .badge { display: inline-block; border-radius: 999px; padding: 3px 9px; font-size: 11px; font-weight: 700; }
    .badge.in { background: #e4f4ec; color: #1f8a57; }
    .badge.out { background: #fcebe8; color: #c0432f; }
    .badge.payable { background: #fbeada; color: #c9742a; }
    .empty { padding: 30px; text-align: center; color: #5c6b7e; }
    .total-row { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 18px; font-size: 14px; font-weight: 700; }
    .total-chip { display: inline-block; min-width: 130px; padding: 7px 14px; border-radius: 999px; text-align: center; font-family: "SF Mono", Consolas, monospace; }
    .total-chip.owes { color: #c0432f; background: #fcefed; }
    .total-chip.payable { color: #c9742a; background: #fbeada; }
    .total-chip.clear { color: #23875a; background: #e7f6ee; }
  </style>
</head>
<body>
  <h1>${escapeHtml(customer.name)} . khata</h1>
  <div class="meta">Downloaded ${escapeHtml(formatPdfDate(new Date().toISOString()))}</div>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Type</th>
        <th>Description</th>
        <th>Not Paid</th>
        <th>Paid</th>
        <th>To Pay</th>
        <th>Balance</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="total-row">
    <span>${escapeHtml(totalLabel)}</span>
    <span>=</span>
    <span class="total-chip ${totalClass}">${escapeHtml(formatPdfMoney(Math.abs(totalAmount)))}</span>
  </div>
</body>
</html>`
}

const safeCustomerFileName = (customer) => {
  return customer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'customer'
}

const normalizeWhatsAppPhone = (phone = '') => {
  let digits = String(phone).replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = `92${digits.slice(1)}`
  if (digits.length === 10 && digits.startsWith('3')) digits = `92${digits}`
  return digits
}

const getKhataPdfRows = (id, entryIds = []) => {
  const khata = getCustomerKhata(id)
  if (!khata) throw new Error('Customer not found')
  const selectedIds = new Set(entryIds.map((entryId) => Number(entryId)).filter((entryId) => entryId > 0))
  const rows = selectedIds.size
    ? khata.rows.filter((row) => selectedIds.has(Number(row.id)))
    : khata.rows
  return { khata, rows }
}

const writeKhataPdfFile = async (customer, rows, filePath) => {
  const win = new BrowserWindow({ show: false })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderKhataPdf(customer, rows))}`)
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' }
    })
    fs.writeFileSync(filePath, pdf)
  } finally {
    win.destroy()
  }
}

const exportCustomerKhata = async (id, entryIds = []) => {
  const { khata, rows } = getKhataPdfRows(id, entryIds)
  const safeName = safeCustomerFileName(khata.customer)
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: `khata-${safeName}.pdf`,
    filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
  })
  if (canceled || !filePath) return { canceled: true }

  await writeKhataPdfFile(khata.customer, rows, filePath)
  return { canceled: false, filePath, count: rows.length }
}

const shareCustomerKhataOnWhatsApp = async (id, entryIds = []) => {
  const { khata, rows } = getKhataPdfRows(id, entryIds)
  const safeName = safeCustomerFileName(khata.customer)
  const folder = app.getPath('downloads')
  fs.mkdirSync(folder, { recursive: true })
  const filePath = path.join(folder, `khata-${safeName}-${Date.now()}.pdf`)

  await writeKhataPdfFile(khata.customer, rows, filePath)

  clipboard.writeText(filePath)

  const phone = normalizeWhatsAppPhone(khata.customer.phone)
  const message = `Khata PDF for ${khata.customer.name} is ready. Please attach the revealed PDF file.`
  const query = phone
    ? `phone=${phone}&text=${encodeURIComponent(message)}`
    : `text=${encodeURIComponent(message)}`
  const whatsappUrl = `whatsapp://send?${query}`
  const webUrl = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`
  try {
    await shell.openExternal(whatsappUrl)
  } catch {
    await shell.openExternal(webUrl)
  }
  shell.showItemInFolder(filePath)

  return { canceled: false, filePath, count: rows.length, openedDirectChat: !!phone }
}

const writeSheet = async (rows, sheetName, defaultName) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
  })
  if (canceled || !filePath) return { canceled: true }

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filePath)
  return { canceled: false, filePath, count: rows.length }
}

const importProducts = async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Spreadsheet', extensions: ['xlsx', 'xls', 'csv'] }]
  })
  if (canceled || !filePaths || !filePaths.length) return { canceled: true }

  const wb = XLSX.readFile(filePaths[0])
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

  const pick = (row, keys) => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== '') return row[k]
    }
    return undefined
  }

  const insert = db.prepare(
    `INSERT INTO products (name, image, quantity, cost, status, created_at)
     VALUES (@name, @image, @quantity, @cost, @status, @created_at)`
  )

  const tx = db.transaction((items) => {
    let count = 0
    for (const r of items) {
      const name = pick(r, ['name', 'Name', 'product_name', 'Product Name'])
      if (!name) continue
      const rawStatus = String(pick(r, ['status', 'Status']) || 'in_stock').toLowerCase()
      insert.run({
        name: String(name),
        image: null,
        quantity: num(pick(r, ['quantity', 'Quantity', 'qty', 'Qty'])),
        cost: num(pick(r, ['cost', 'Cost', 'net_price', 'net price', 'Net Price', 'price', 'Price'])),
        status: rawStatus.includes('out') ? 'out_of_stock' : 'in_stock',
        created_at: nowISO()
      })
      count++
    }
    return count
  })

  const count = tx(rows)
  return { canceled: false, count }
}

const backupTo = (destPath) => {
  // Online backup: safe even while the app is running; includes WAL data.
  return db.backup(destPath)
}

export {
  init,
  backupTo,
  hasAppUser,
  getAppUser,
  createAppUser,
  getProducts,
  getProductById,
  listProductsBrief,
  createProduct,
  updateProduct,
  deleteProduct,
  deleteProducts,
  listCustomers,
  listCustomersBrief,
  getCustomerKhata,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  deleteCustomers,
  deleteCustomerLedgerEntries,
  receiveCustomerPayment,
  addCustomerCharge,
  addCustomerPayable,
  getOrders,
  createOrder,
  updateOrder,
  deleteOrder,
  deleteOrders,
  getDashboard,
  exportProducts,
  exportOrders,
  exportCustomerKhata,
  shareCustomerKhataOnWhatsApp,
  importProducts
}

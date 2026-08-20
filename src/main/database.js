import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import XLSX from 'xlsx'
import { app, BrowserWindow, clipboard, dialog, shell } from 'electron'

let db

const pad2 = (n) => String(n).padStart(2, '0')

/** Local wall-clock timestamp (no UTC Z suffix) for business dates/times. */
const nowLocalISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/** Backward-compatible alias — all new timestamps use local time. */
const nowISO = () => nowLocalISO()

const utcToLocalISO = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/** yyyy-mm-dd in the machine's local timezone (for filters, dashboard grouping, display). */
const localDateKey = (iso) => {
  if (!iso) return ''
  const s = String(iso)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s.slice(0, 10)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const migrateTimestampsToLocal = () => {
  const tables = [
    ['orders', 'created_at'],
    ['order_payments', 'created_at'],
    ['products', 'created_at'],
    ['customers', 'created_at'],
    ['customer_ledger', 'created_at'],
    ['expenses', 'created_at'],
    ['expense_wallet_ledger', 'created_at'],
    ['app_user', 'created_at']
  ]

  db.transaction(() => {
    for (const [table, col] of tables) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
      if (!cols.includes(col)) continue
      const rows = db.prepare(`SELECT id, ${col} AS v FROM ${table} WHERE ${col} LIKE '%Z'`).all()
      if (!rows.length) continue
      const upd = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE id = ?`)
      for (const row of rows) {
        upd.run(utcToLocalISO(row.v), row.id)
      }
    }
  })()
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

const isReceivedCreditRow = (row) => (
  row.type === 'credit'
  && (row.credit_kind === 'received' || (!row.credit_kind && !row.order_id))
)

const isOrderCreditRow = (row) => (
  row.type === 'credit'
  && (row.credit_kind === 'order' || (!row.credit_kind && row.order_id))
)

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
      quantity    REAL    NOT NULL DEFAULT 0,
      cost        REAL    NOT NULL DEFAULT 0,
      status      TEXT    NOT NULL DEFAULT 'in_stock',
      unit_type   TEXT    NOT NULL DEFAULT 'quantity',
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

    CREATE TABLE IF NOT EXISTS expenses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      notes       TEXT,
      amount      REAL    NOT NULL DEFAULT 0,
      method      TEXT,
      created_at  TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expense_ledger (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id   INTEGER NOT NULL,
      type         TEXT    NOT NULL CHECK (type IN ('spend', 'deduct')),
      amount       REAL    NOT NULL DEFAULT 0,
      description  TEXT,
      method       TEXT,
      created_at   TEXT    NOT NULL,
      FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expense_wallet_ledger (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT    NOT NULL CHECK (type IN ('credit', 'debit')),
      amount       REAL    NOT NULL DEFAULT 0,
      description  TEXT,
      method       TEXT,
      expense_id   INTEGER,
      created_at   TEXT    NOT NULL
    );
  `)

  migrateOrdersSchema()
  migrateOrderArchive()
  migrateOrderCustomerFields()
  migrateOrderImage()
  migrateOrderItemsSchema()
  migrateOrderPayments()
  migrateTimestampsToLocal()
  migrateCustomerLedgerTypes()
  migrateCustomerLedgerExtensions()
  migrateProductsSchema()
  migrateProductsUnitType()
  migrateExpenseAmountColumn()
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

const migrateExpenseAmountColumn = () => {
  const cols = db.prepare('PRAGMA table_info(expenses)').all().map((c) => c.name)
  if (!cols.includes('amount')) {
    db.exec('ALTER TABLE expenses ADD COLUMN amount REAL NOT NULL DEFAULT 0')
  }
  if (!cols.includes('method')) {
    db.exec('ALTER TABLE expenses ADD COLUMN method TEXT')
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS expense_wallet_ledger (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT    NOT NULL CHECK (type IN ('credit', 'debit')),
      amount       REAL    NOT NULL DEFAULT 0,
      description  TEXT,
      method       TEXT,
      expense_id   INTEGER,
      created_at   TEXT    NOT NULL
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

  return { rows, total, page, pageSize, inventoryTotal: getProductsInventoryTotal() }
}

const resolveProductStatus = (quantity) => {
  return num(quantity) > 0 ? 'in_stock' : 'out_of_stock'
}

const createProduct = (data) => {
  const quantity = num(data.quantity)
  const info = db
    .prepare(
      `INSERT INTO products (name, image, quantity, cost, status, unit_type, created_at)
       VALUES (@name, @image, @quantity, @cost, @status, @unit_type, @created_at)`
    )
    .run({
      name: data.name || 'Unnamed product',
      image: data.image || null,
      quantity,
      cost: num(data.cost),
      status: resolveProductStatus(quantity),
      unit_type: normalizeUnitType(data.unit_type),
      created_at: nowISO()
    })
  return getProductById(info.lastInsertRowid)
}

const updateProduct = ({ id, data }) => {
  const quantity = num(data.quantity)
  db.prepare(
    `UPDATE products
     SET name = @name, image = @image, quantity = @quantity,
         cost = @cost, status = @status, unit_type = @unit_type
     WHERE id = @id`
  ).run({
    id,
    name: data.name || 'Unnamed product',
    image: data.image || null,
    quantity,
    cost: num(data.cost),
    status: resolveProductStatus(quantity),
    unit_type: normalizeUnitType(data.unit_type)
  })
  return getProductById(id)
}

const increaseProductsCostByPercent = ({ ids, percent }) => {
  const list = [...new Set(ids.map((id) => Number(id)).filter((id) => id > 0))]
  const pct = num(percent)
  if (!list.length) return { ok: true, count: 0 }
  if (!Number.isFinite(pct)) throw new Error('Invalid percentage value')

  const factor = 1 + pct / 100
  const placeholders = list.map(() => '?').join(', ')
  const result = db.prepare(
    `UPDATE products SET cost = ROUND(cost * ?, 4) WHERE id IN (${placeholders})`
  ).run(factor, ...list)
  return { ok: true, count: result.changes }
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

const migrateOrderImage = () => {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name)
  if (!cols.includes('image')) {
    db.exec('ALTER TABLE orders ADD COLUMN image TEXT')
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

const PAYMENT_EPS = 0.009

const isActiveOrderStatus = (status) => {
  return status === 'PAID' || status === 'NOT_PAID' || status === 'PARTIALLY_PAID' || status === 'DONE'
}

const resolveOrderStatus = (requestedStatus, paidAmount, orderTotal) => {
  if (requestedStatus === 'CANCELLED') return 'CANCELLED'
  const paid = Math.max(0, num(paidAmount))
  const total = Math.max(0, num(orderTotal))
  if (total <= 0 || paid + PAYMENT_EPS >= total) return 'PAID'
  if (paid <= PAYMENT_EPS) return 'NOT_PAID'
  return 'PARTIALLY_PAID'
}

const migrateOrderPayments = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_payments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id    INTEGER NOT NULL,
      amount      REAL    NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
  `)

  const existing = db.prepare('SELECT COUNT(*) AS c FROM order_payments').get().c
  if (existing === 0) {
    const orders = db
      .prepare('SELECT id, paid_amount, created_at, status FROM orders WHERE paid_amount > 0')
      .all()
    const insert = db.prepare(
      `INSERT INTO order_payments (order_id, amount, created_at) VALUES (@order_id, @amount, @created_at)`
    )
    db.transaction(() => {
      for (const order of orders) {
        if (order.status === 'CANCELLED') continue
        insert.run({
          order_id: order.id,
          amount: num(order.paid_amount),
          created_at: order.created_at || nowISO()
        })
      }
    })()
  }

  // Migrate legacy DONE → payment-based statuses (Paid / Not paid / Partially Paid)
  db.prepare(`UPDATE orders SET status = 'PAID' WHERE status = 'DONE'`).run()

  const activeOrders = db
    .prepare(`SELECT id, paid_amount, status FROM orders WHERE isArchive = 0 AND status != 'CANCELLED'`)
    .all()
  const sumItems = db.prepare('SELECT COALESCE(SUM(total_price), 0) AS total FROM order_items WHERE order_id = ?')
  const updateStatus = db.prepare('UPDATE orders SET status = ? WHERE id = ?')
  db.transaction(() => {
    for (const order of activeOrders) {
      const total = num(sumItems.get(order.id)?.total)
      const next = resolveOrderStatus(order.status, order.paid_amount, total)
      if (next !== order.status) updateStatus.run(next, order.id)
    }
  })()
}

const sumPaymentsForOrder = (orderId) => {
  const row = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM order_payments WHERE order_id = ?').get(orderId)
  return num(row?.total)
}

const listPaymentsForOrder = (orderId) => {
  return db
    .prepare('SELECT id, order_id, amount, created_at FROM order_payments WHERE order_id = ? ORDER BY datetime(created_at), id')
    .all(orderId)
    .map((row) => ({
      id: row.id,
      order_id: row.order_id,
      amount: num(row.amount),
      created_at: row.created_at
    }))
}

const insertOrderPayment = (orderId, amount, createdAt = nowISO()) => {
  const value = num(amount)
  if (value <= 0) return null
  const info = db.prepare(
    `INSERT INTO order_payments (order_id, amount, created_at) VALUES (@order_id, @amount, @created_at)`
  ).run({ order_id: orderId, amount: value, created_at: createdAt })
  return info.lastInsertRowid
}

/** Sync order_payments so their sum matches targetPaid. Extra payments use paymentAt (default now). */
const syncOrderPayments = (orderId, targetPaid, { paymentAt = nowISO(), seedAt = null } = {}) => {
  const target = Math.max(0, num(targetPaid))
  const current = sumPaymentsForOrder(orderId)
  const delta = target - current

  if (Math.abs(delta) <= PAYMENT_EPS) return

  if (delta > PAYMENT_EPS) {
    insertOrderPayment(orderId, delta, seedAt || paymentAt)
    return
  }

  // Reduce payments from newest to oldest when paid_amount is lowered
  let remaining = Math.abs(delta)
  const payments = db
    .prepare('SELECT id, amount FROM order_payments WHERE order_id = ? ORDER BY datetime(created_at) DESC, id DESC')
    .all(orderId)

  for (const payment of payments) {
    if (remaining <= PAYMENT_EPS) break
    const amount = num(payment.amount)
    if (amount <= remaining + PAYMENT_EPS) {
      db.prepare('DELETE FROM order_payments WHERE id = ?').run(payment.id)
      remaining -= amount
    } else {
      db.prepare('UPDATE order_payments SET amount = ? WHERE id = ?').run(amount - remaining, payment.id)
      remaining = 0
    }
  }
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

const migrateCustomerLedgerExtensions = () => {
  const cols = db.prepare('PRAGMA table_info(customer_ledger)').all().map((c) => c.name)
  if (!cols.includes('debit_kind')) {
    db.exec('ALTER TABLE customer_ledger ADD COLUMN debit_kind TEXT')
    db.exec("UPDATE customer_ledger SET debit_kind = 'order' WHERE order_id IS NOT NULL AND type = 'debit'")
    db.exec("UPDATE customer_ledger SET debit_kind = 'non_sale' WHERE order_id IS NULL AND type = 'debit'")
  }
  if (!cols.includes('dashboard_sales')) {
    db.exec('ALTER TABLE customer_ledger ADD COLUMN dashboard_sales REAL NOT NULL DEFAULT 0')
  }
  if (!cols.includes('credit_kind')) {
    db.exec('ALTER TABLE customer_ledger ADD COLUMN credit_kind TEXT')
    db.exec("UPDATE customer_ledger SET credit_kind = 'order' WHERE type = 'credit' AND order_id IS NOT NULL")
    db.exec("UPDATE customer_ledger SET credit_kind = 'received' WHERE type = 'credit' AND order_id IS NULL")
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_allocations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_id   INTEGER NOT NULL,
      debit_id    INTEGER NOT NULL,
      amount      REAL    NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL,
      FOREIGN KEY (credit_id) REFERENCES customer_ledger(id) ON DELETE CASCADE,
      FOREIGN KEY (debit_id) REFERENCES customer_ledger(id) ON DELETE CASCADE
    );
  `)
}

const resolveDebitKind = ({ type, order_id, debit_kind }) => {
  if (type !== 'debit') return null
  if (order_id) return 'order'
  return debit_kind || 'non_sale'
}

const resolveCreditKind = ({ type, order_id, credit_kind }) => {
  if (type !== 'credit') return null
  if (credit_kind) return credit_kind
  if (order_id) return 'order'
  return 'received'
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
      quantity    REAL    NOT NULL DEFAULT 0,
      cost        REAL    NOT NULL DEFAULT 0,
      status      TEXT    NOT NULL DEFAULT 'in_stock',
      unit_type   TEXT    NOT NULL DEFAULT 'quantity',
      created_at  TEXT    NOT NULL
    );
    INSERT INTO products_new (id, name, image, quantity, cost, status, unit_type, created_at)
    SELECT id, name, image, quantity, ${costSource}, status, 'quantity', created_at FROM products;
    DROP TABLE products;
    ALTER TABLE products_new RENAME TO products;
  `)
}

const migrateProductsUnitType = () => {
  const cols = db.prepare('PRAGMA table_info(products)').all()
  const colNames = cols.map((c) => c.name)
  if (!colNames.length) return

  const quantityCol = cols.find((c) => c.name === 'quantity')
  const needsUnitType = !colNames.includes('unit_type')
  const needsRealQty = quantityCol && quantityCol.type.toUpperCase().includes('INT')

  if (!needsUnitType && !needsRealQty) return

  if (needsUnitType && !needsRealQty) {
    db.exec("ALTER TABLE products ADD COLUMN unit_type TEXT NOT NULL DEFAULT 'quantity'")
    return
  }

  const unitTypeSelect = colNames.includes('unit_type') ? 'unit_type' : "'quantity'"
  db.exec(`
    CREATE TABLE products_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      image       TEXT,
      quantity    REAL    NOT NULL DEFAULT 0,
      cost        REAL    NOT NULL DEFAULT 0,
      status      TEXT    NOT NULL DEFAULT 'in_stock',
      unit_type   TEXT    NOT NULL DEFAULT 'quantity',
      created_at  TEXT    NOT NULL
    );
    INSERT INTO products_new (id, name, image, quantity, cost, status, unit_type, created_at)
    SELECT id, name, image, quantity, cost, status, ${unitTypeSelect}, created_at FROM products;
    DROP TABLE products;
    ALTER TABLE products_new RENAME TO products;
  `)
}

const PRODUCT_UNIT_TYPES = ['quantity', 'weight', 'gaz']

const normalizeUnitType = (value) => {
  const unitType = String(value || 'quantity').toLowerCase()
  return PRODUCT_UNIT_TYPES.includes(unitType) ? unitType : 'quantity'
}

const productStockValue = (product) => num(product?.cost) * num(product?.quantity)

const getProductsInventoryTotal = () => {
  const row = db.prepare('SELECT COALESCE(SUM(cost * quantity), 0) AS total FROM products').get()
  return num(row?.total)
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
  const payments = listPaymentsForOrder(order.id)
  const order_total = items.reduce((sum, item) => sum + num(item.total_price), 0)
  const paid_amount = num(order.paid_amount)
  return {
    ...order,
    items,
    payments,
    order_total,
    remaining_amount: Math.max(0, order_total - paid_amount)
  }
}

const getOrderById = (id) => {
  const order = db
    .prepare(
      `SELECT o.id, o.status, o.created_at, o.customer_id, o.paid_amount, o.image, c.name AS customer_name
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

const getCustomerKhata = (id, filters = {}) => {
  const customer = getCustomerSummary(id)
  if (!customer) return null
  const startDate = filters.startDate || ''
  const endDate = filters.endDate || ''
  const allRows = db
    .prepare(
      `SELECT l.*, o.image AS order_image
       FROM customer_ledger l
       LEFT JOIN orders o ON o.id = l.order_id
       WHERE l.customer_id = ?
       ORDER BY datetime(l.created_at), l.id`
    )
    .all(id)
  const balanced = ledgerWithRunningBalance(allRows)
  const rows = balanced.filter((row) => {
    const dateKey = localDateKey(row.created_at)
    if (startDate && dateKey < startDate) return false
    if (endDate && dateKey > endDate) return false
    return true
  })
  return { customer, rows, startDate, endDate }
}

const addLedgerEntry = ({
  customer_id,
  order_id = null,
  type,
  amount,
  description = '',
  method = '',
  created_at = nowISO(),
  debit_kind = null,
  credit_kind = null,
  dashboard_sales = 0
}) => {
  const value = num(amount)
  if (!customer_id) throw new Error('Select a customer')
  if (!['debit', 'credit', 'payable'].includes(type)) throw new Error('Invalid ledger entry type')
  if (value <= 0) throw new Error('Amount must be greater than 0')

  const info = db.prepare(
    `INSERT INTO customer_ledger
     (customer_id, order_id, type, amount, description, method, created_at, debit_kind, credit_kind, dashboard_sales)
     VALUES (@customer_id, @order_id, @type, @amount, @description, @method, @created_at, @debit_kind, @credit_kind, @dashboard_sales)`
  ).run({
    customer_id,
    order_id,
    type,
    amount: value,
    description,
    method,
    created_at,
    debit_kind: resolveDebitKind({ type, order_id, debit_kind }),
    credit_kind: resolveCreditKind({ type, order_id, credit_kind }),
    dashboard_sales: Math.max(0, num(dashboard_sales))
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
      description: 'Opening balance',
      debit_kind: 'non_sale'
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

const getSettledDebitAmount = (debitId) => {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_allocations WHERE debit_id = ?')
    .get(debitId)
  return num(row?.total)
}

const planNonSaleDebitAllocation = (customerId, pool) => {
  let remainingPool = Math.max(0, num(pool))
  if (remainingPool <= PAYMENT_EPS) {
    return { allocated: 0, remainder: remainingPool, debitsSettled: [] }
  }

  const debits = db
    .prepare(
      `SELECT id, amount
       FROM customer_ledger
       WHERE customer_id = @customerId
         AND type = 'debit'
         AND order_id IS NULL
         AND COALESCE(debit_kind, 'non_sale') = 'non_sale'
       ORDER BY datetime(created_at), id`
    )
    .all({ customerId })

  let allocated = 0
  const debitsSettled = []

  for (const debit of debits) {
    if (remainingPool <= PAYMENT_EPS) break
    const openAmount = num(debit.amount) - getSettledDebitAmount(debit.id)
    if (openAmount <= PAYMENT_EPS) continue
    const applied = Math.min(remainingPool, openAmount)
    debitsSettled.push({ debitId: debit.id, amount: applied })
    allocated += applied
    remainingPool -= applied
  }

  return { allocated, remainder: remainingPool, debitsSettled }
}

const recordLedgerAllocations = (creditId, debitsSettled, created_at = nowISO()) => {
  if (!creditId || !debitsSettled?.length) return
  const insert = db.prepare(
    `INSERT INTO ledger_allocations (credit_id, debit_id, amount, created_at)
     VALUES (@credit_id, @debit_id, @amount, @created_at)`
  )
  for (const item of debitsSettled) {
    insert.run({
      credit_id: creditId,
      debit_id: item.debitId,
      amount: num(item.amount),
      created_at
    })
  }
}

const recordNonSaleAllocations = (creditId, debitsSettled, created_at = nowISO()) => {
  recordLedgerAllocations(creditId, debitsSettled, created_at)
}

const applyOrderPaymentUpdate = (orderId, applied, paymentAt) => {
  const appliedAmount = Math.max(0, num(applied))
  if (appliedAmount <= PAYMENT_EPS) return 0

  const order = db.prepare('SELECT id, status, customer_id, paid_amount FROM orders WHERE id = ?').get(orderId)
  if (!order || order.status === 'CANCELLED') return 0

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId).map(mapOrderItem)
  const orderTotal = items.reduce((sum, item) => sum + num(item.total_price), 0)
  const newPaid = Math.min(orderTotal, num(order.paid_amount) + appliedAmount)
  const newStatus = resolveOrderStatus(order.status, newPaid, orderTotal)

  db.prepare('UPDATE orders SET paid_amount = @paid_amount, status = @status WHERE id = @id').run({
    id: orderId,
    paid_amount: newPaid,
    status: newStatus
  })
  insertOrderPayment(orderId, appliedAmount, paymentAt)
  return appliedAmount
}

const ensureOrderLedgerDebit = (customerId, order) => {
  const existing = db
    .prepare(
      `SELECT id, amount
       FROM customer_ledger
       WHERE customer_id = @customerId
         AND order_id = @orderId
         AND type = 'debit'
       ORDER BY id
       LIMIT 1`
    )
    .get({ customerId, orderId: order.id })
  if (existing) return existing

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id).map(mapOrderItem)
  replaceOrderLedger({
    orderId: order.id,
    customerId,
    status: order.status,
    paidAmount: num(order.paid_amount),
    items,
    method: ''
  })
  return db
    .prepare(
      `SELECT id, amount
       FROM customer_ledger
       WHERE customer_id = @customerId
         AND order_id = @orderId
         AND type = 'debit'
       ORDER BY id
       LIMIT 1`
    )
    .get({ customerId, orderId: order.id })
}

const planOrderDebitAllocation = (customerId, pool) => {
  let remainingPool = Math.max(0, num(pool))
  if (remainingPool <= PAYMENT_EPS) {
    return { allocated: 0, remainder: remainingPool, debitsSettled: [], ordersUpdated: [] }
  }

  const debitsSettled = []
  const ordersUpdated = []

  for (const order of getUnpaidOrdersForCustomer(customerId)) {
    if (remainingPool <= PAYMENT_EPS) break

    const debit = ensureOrderLedgerDebit(customerId, order)
    if (!debit) continue

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id).map(mapOrderItem)
    const orderTotal = items.reduce((sum, item) => sum + num(item.total_price), 0)
    const remainingDue = Math.max(0, orderTotal - num(order.paid_amount))
    if (remainingDue <= PAYMENT_EPS) continue

    const applied = Math.min(remainingPool, remainingDue)
    debitsSettled.push({ debitId: debit.id, amount: applied })
    ordersUpdated.push({ orderId: order.id, applied })
    remainingPool -= applied
  }

  return {
    allocated: num(pool) - remainingPool,
    remainder: remainingPool,
    debitsSettled,
    ordersUpdated
  }
}

const receiveCustomerPayment = ({ id, data }) => {
  const paymentAt = data.created_at || nowISO()
  const amount = num(data.amount)
  const method = data.method || 'Cash'
  const description = data.description || 'Payment received'
  const paymentMode = data.paymentMode === 'non_orders' ? 'non_orders' : 'orders'

  return db.transaction(() => {
    const entry = addLedgerEntry({
      customer_id: id,
      type: 'credit',
      amount,
      description,
      method,
      created_at: paymentAt,
      credit_kind: 'received'
    })

    if (paymentMode === 'non_orders') {
      const nonSalePlan = planNonSaleDebitAllocation(id, amount)
      recordLedgerAllocations(entry.id, nonSalePlan.debitsSettled, paymentAt)
      if (amount > PAYMENT_EPS) {
        db.prepare('UPDATE customer_ledger SET dashboard_sales = ? WHERE id = ?')
          .run(amount, entry.id)
        entry.dashboard_sales = amount
      }

      return {
        ...entry,
        allocation: {
          allocated: 0,
          remainder: nonSalePlan.remainder,
          ordersUpdated: [],
          nonSaleAllocated: nonSalePlan.allocated,
          advance: nonSalePlan.remainder,
          debitsSettled: nonSalePlan.debitsSettled.length,
          paymentMode
        }
      }
    }

    const orderPlan = planOrderDebitAllocation(id, amount)
    recordLedgerAllocations(entry.id, orderPlan.debitsSettled, paymentAt)
    for (const item of orderPlan.ordersUpdated) {
      applyOrderPaymentUpdate(item.orderId, item.applied, paymentAt)
    }

    const nonSalePlan = planNonSaleDebitAllocation(id, orderPlan.remainder)
    recordLedgerAllocations(entry.id, nonSalePlan.debitsSettled, paymentAt)
    if (nonSalePlan.allocated > PAYMENT_EPS) {
      db.prepare('UPDATE customer_ledger SET dashboard_sales = ? WHERE id = ?')
        .run(nonSalePlan.allocated, entry.id)
      entry.dashboard_sales = nonSalePlan.allocated
    }

    return {
      ...entry,
      allocation: {
        allocated: orderPlan.allocated,
        remainder: nonSalePlan.remainder,
        ordersUpdated: orderPlan.ordersUpdated,
        nonSaleAllocated: nonSalePlan.allocated,
        advance: nonSalePlan.remainder,
        debitsSettled: orderPlan.debitsSettled.length + nonSalePlan.debitsSettled.length,
        paymentMode
      }
    }
  })()
}

const addCustomerCharge = ({ id, data }) => {
  return addLedgerEntry({
    customer_id: id,
    type: 'debit',
    amount: data.amount,
    description: data.description || 'Manual khata entry',
    method: data.method || '',
    created_at: data.created_at || nowISO(),
    debit_kind: 'non_sale'
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

const replaceOrderLedger = ({ orderId, customerId, status, paidAmount, items, method = 'Cash' }) => {
  db.prepare('DELETE FROM customer_ledger WHERE order_id = ?').run(orderId)
  if (!isActiveOrderStatus(status) || !customerId) return

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
      method,
      credit_kind: 'order'
    })
  }
}

const getUnpaidOrdersForCustomer = (customerId) => {
  return db
    .prepare(
      `SELECT o.id, o.paid_amount, o.status, o.customer_id, o.created_at,
              COALESCE((SELECT SUM(total_price) FROM order_items WHERE order_id = o.id), 0) AS order_total
       FROM orders o
       WHERE o.customer_id = @customerId
         AND o.isArchive = 0
         AND o.status != 'CANCELLED'
       ORDER BY datetime(o.created_at) ASC, o.id ASC`
    )
    .all({ customerId })
    .filter((order) => num(order.paid_amount) + PAYMENT_EPS < num(order.order_total))
}

const normalizeOrderStatuses = (filters = {}) => {
  const raw = filters.status
  if (raw == null || raw === '') return []
  const list = Array.isArray(raw) ? raw : String(raw).split(',')
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))]
}

const getOrders = (filters = {}) => {
  const page = Math.max(1, num(filters.page, 1))
  const pageSize = Math.max(1, num(filters.pageSize, 25))

  const where = ['o.isArchive = 0']
  const params = {}
  const fromSql = 'FROM orders o LEFT JOIN customers c ON c.id = o.customer_id'

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
  if (filters.customerName) {
    where.push('c.name LIKE @customerName')
    params.customerName = `%${String(filters.customerName).trim()}%`
  }
  const statuses = normalizeOrderStatuses(filters)
  if (statuses.length) {
    const placeholders = statuses.map((_, idx) => `@status${idx}`).join(', ')
    where.push(`o.status IN (${placeholders})`)
    statuses.forEach((status, idx) => { params[`status${idx}`] = status })
  }
  if (filters.startDate) {
    where.push('substr(o.created_at, 1, 10) >= @startDate')
    params.startDate = filters.startDate
  }
  if (filters.endDate) {
    where.push('substr(o.created_at, 1, 10) <= @endDate')
    params.endDate = filters.endDate
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) AS c ${fromSql} ${whereSql}`).get(params).c
  const orders = db
    .prepare(
      `SELECT o.id, o.status, o.created_at, o.customer_id, o.paid_amount, o.image, c.name AS customer_name
       ${fromSql}
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

  const created_at = data.created_at || nowISO()
  const customer_id = data.customer_id ? num(data.customer_id) : null
  const image = data.image || null
  const resolved = items.map((raw) => resolveItemPricing(raw))
  const orderTotal = resolved.reduce((sum, item) => sum + num(item.total_price), 0)
  const paid_amount = Math.min(Math.max(num(data.paid_amount), 0), orderTotal)
  const status = resolveOrderStatus(data.status, paid_amount, orderTotal)

  const insertOrder = db.prepare(
    `INSERT INTO orders (status, created_at, isArchive, customer_id, paid_amount, image)
     VALUES (@status, @created_at, 0, @customer_id, @paid_amount, @image)`
  )
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, quantity, total_price, unit_cost, profit)
     VALUES (@order_id, @product_id, @product_name, @quantity, @total_price, @unit_cost, @profit)`
  )

  const orderId = db.transaction(() => {
    const info = insertOrder.run({ status, created_at, customer_id, paid_amount, image })
    const id = info.lastInsertRowid
    for (const item of resolved) {
      insertItem.run({ order_id: id, ...item })
    }
    if (isActiveOrderStatus(status)) deductInventory(resolved)
    syncOrderPayments(id, paid_amount, { seedAt: created_at })
    replaceOrderLedger({ orderId: id, customerId: customer_id, status, paidAmount: paid_amount, items: resolved })
    return id
  })()

  return getOrderById(orderId)
}

const updateOrder = ({ id, data }) => {
  const items = normalizeOrderItems(data)
  if (!items.length) throw new Error('Order must include at least one product')

  const customer_id = data.customer_id ? num(data.customer_id) : null
  const image = data.image || null
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, quantity, total_price, unit_cost, profit)
     VALUES (@order_id, @product_id, @product_name, @quantity, @total_price, @unit_cost, @profit)`
  )
  const existingOrder = db.prepare('SELECT status, created_at FROM orders WHERE id = ?').get(id)
  const existingItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id)
  const existingByProduct = new Map(existingItems.map((i) => [i.product_id, i]))

  db.transaction(() => {
    if (isActiveOrderStatus(existingOrder?.status)) restoreInventory(existingItems)

    const resolved = items.map((raw) => {
      const productId = raw.product_id ? num(raw.product_id) : null
      const existing = productId ? existingByProduct.get(productId) : null
      return resolveItemPricing(raw, existing)
    })
    const orderTotal = resolved.reduce((sum, item) => sum + num(item.total_price), 0)
    const paid_amount = Math.min(Math.max(num(data.paid_amount), 0), orderTotal)
    const status = resolveOrderStatus(data.status, paid_amount, orderTotal)

    db.prepare(
      'UPDATE orders SET status = @status, customer_id = @customer_id, paid_amount = @paid_amount, image = @image WHERE id = @id'
    ).run({ id, status, customer_id, paid_amount, image })
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id)

    for (const item of resolved) {
      insertItem.run({ order_id: id, ...item })
    }
    if (isActiveOrderStatus(status)) deductInventory(resolved)
    syncOrderPayments(id, paid_amount, { paymentAt: nowISO() })
    replaceOrderLedger({ orderId: id, customerId: customer_id, status, paidAmount: paid_amount, items: resolved })
  })()

  return getOrderById(id)
}

const deleteOrder = (id) => {
  const order = db.prepare('SELECT status FROM orders WHERE id = ? AND isArchive = 0').get(id)
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id)

  db.transaction(() => {
    if (isActiveOrderStatus(order?.status)) restoreInventory(items)
    db.prepare('DELETE FROM customer_ledger WHERE order_id = ?').run(id)
    db.prepare('DELETE FROM order_payments WHERE order_id = ?').run(id)
    db.prepare('UPDATE orders SET isArchive = 1 WHERE id = ? AND isArchive = 0').run(id)
  })()

  return { ok: true, count: order ? 1 : 0 }
}

const deleteOrders = (ids = []) => {
  const list = [...new Set(ids.map((id) => Number(id)).filter((id) => id > 0))]
  if (!list.length) return { ok: true, count: 0 }

  let count = 0
  db.transaction(() => {
    for (const id of list) {
      const order = db.prepare('SELECT status FROM orders WHERE id = ? AND isArchive = 0').get(id)
      if (!order) continue
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id)
      if (isActiveOrderStatus(order.status)) restoreInventory(items)
      db.prepare('DELETE FROM customer_ledger WHERE order_id = ?').run(id)
      db.prepare('DELETE FROM order_payments WHERE order_id = ?').run(id)
      const result = db.prepare('UPDATE orders SET isArchive = 1 WHERE isArchive = 0 AND id = ?').run(id)
      count += result.changes
    }
  })()

  return { ok: true, count }
}

/* ------------------------------------------------------------ dashboard */
// Sales / profit / items are attributed to payment dates (order_payments),
// not order creation dates. Profit uses cost-recovery-first: each payment
// first covers remaining product cost, then counts as profit.

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

/**
 * Allocate each payment into sales / profit / items using cost-recovery-first.
 * When productIds is set, only the share of each payment attributable to those
 * products is counted (by line total_price weight).
 */
const allocateOrderPaymentMetrics = (items, payments, productIds = []) => {
  const allItems = items || []
  const orderTotal = allItems.reduce((sum, item) => sum + num(item.total_price), 0)
  if (orderTotal <= 0 || !payments?.length) return []

  const filteredItems = productIds.length
    ? allItems.filter((item) => productIds.includes(num(item.product_id)))
    : allItems
  if (!filteredItems.length) return []

  const filteredTotal = filteredItems.reduce((sum, item) => sum + num(item.total_price), 0)
  if (filteredTotal <= 0) return []

  const filteredQty = filteredItems.reduce((sum, item) => sum + num(item.quantity), 0)
  let remainingCost = filteredItems.reduce(
    (sum, item) => sum + num(item.unit_cost) * num(item.quantity),
    0
  )
  const share = filteredTotal / orderTotal

  return payments.map((payment) => {
    const amount = Math.max(0, num(payment.amount) * share)
    const costPart = Math.min(amount, Math.max(0, remainingCost))
    const profitPart = amount - costPart
    remainingCost -= costPart
    return {
      date: localDateKey(payment.created_at),
      sales: amount,
      profit: profitPart,
      items: orderTotal > 0 ? filteredQty * (num(payment.amount) / orderTotal) : 0
    }
  })
}

const loadDashboardPaymentAllocations = (filters = {}) => {
  const productIds = normalizeProductIds(filters)
  const orders = db
    .prepare(
      `SELECT id FROM orders
       WHERE isArchive = 0 AND status IN ('PAID', 'NOT_PAID', 'PARTIALLY_PAID', 'DONE')`
    )
    .all()

  const getItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?')
  const getPayments = db.prepare(
    `SELECT id, amount, created_at FROM order_payments
     WHERE order_id = ?
     ORDER BY datetime(created_at), id`
  )

  const allocations = []
  for (const order of orders) {
    const items = getItems.all(order.id)
    const payments = getPayments.all(order.id)
    allocations.push(...allocateOrderPaymentMetrics(items, payments, productIds))
  }

  if (!productIds.length) {
    const khataSales = db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS date, dashboard_sales AS sales
         FROM customer_ledger
         WHERE type = 'credit' AND dashboard_sales > 0`
      )
      .all()
    for (const row of khataSales) {
      allocations.push({
        date: row.date,
        sales: num(row.sales),
        profit: 0,
        items: 0
      })
    }
  }

  return allocations
}

const aggregateAllocations = (allocations, startDate, endDate) => {
  const byDate = {}
  for (const row of allocations) {
    if (!row.date) continue
    if (startDate && row.date < startDate) continue
    if (endDate && row.date > endDate) continue
    if (!byDate[row.date]) byDate[row.date] = { date: row.date, sales: 0, profit: 0, items: 0 }
    byDate[row.date].sales += row.sales
    byDate[row.date].profit += row.profit
    byDate[row.date].items += row.items
  }

  const series = Object.values(byDate)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((r) => ({
      date: r.date,
      sales: num(r.sales),
      profit: num(r.profit),
      items: num(r.items)
    }))

  const totals = series.reduce(
    (a, r) => ({
      sales: a.sales + r.sales,
      profit: a.profit + r.profit,
      items: a.items + r.items
    }),
    { sales: 0, profit: 0, items: 0 }
  )

  return { series, totals }
}

const getOrderTotalsForRange = (startDate, endDate, filters = {}) => {
  const allocations = loadDashboardPaymentAllocations(filters)
  return aggregateAllocations(allocations, startDate, endDate).totals
}

const getDashboard = (filters = {}) => {
  const allocations = loadDashboardPaymentAllocations(filters)
  const { series, totals } = aggregateAllocations(allocations, filters.startDate, filters.endDate)
  const filledSeries = fillSeriesGaps(series, filters.startDate, filters.endDate)

  let previousTotals = { sales: 0, profit: 0, items: 0 }
  let previousPeriod = null

  if (filters.startDate && filters.endDate) {
    previousPeriod = previousPeriodDates(filters.startDate, filters.endDate)
    previousTotals = aggregateAllocations(
      allocations,
      previousPeriod.startDate,
      previousPeriod.endDate
    ).totals
  }

  return { series: filledSeries, totals, previousTotals, previousPeriod }
}

/* --------------------------------------------------------- excel import/export */

const exportProducts = async () => {
  const rows = db
    .prepare(
      `SELECT id AS product_number, name, quantity, cost, status, unit_type, created_at
       FROM products ORDER BY id`
    )
    .all()
  return writeSheet(rows, 'Products', 'products.xlsx')
}

const exportOrders = async () => {
  const rows = db
    .prepare(
      `SELECT o.id AS order_number, i.product_id, i.product_name, i.quantity,
              i.total_price, i.unit_cost, i.profit, o.paid_amount, o.status, o.created_at
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
        <td class="num">${isReceivedCreditRow(row) ? escapeHtml(formatPdfMoney(row.amount)) : '-'}</td>
        <td class="num">${row.type === 'debit' ? escapeHtml(formatPdfMoney(row.amount)) : '-'}</td>
        <td class="num">${isOrderCreditRow(row) ? escapeHtml(formatPdfMoney(row.amount)) : '-'}</td>
        <td class="num">${row.type === 'payable' ? escapeHtml(formatPdfMoney(row.amount)) : '-'}</td>
        <td class="num strong">${escapeHtml(formatPdfMoney(row.running_balance))}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="8" class="empty">No khata entries selected.</td></tr>'

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
        <th>Received</th>
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
    `INSERT INTO products (name, image, quantity, cost, status, unit_type, created_at)
     VALUES (@name, @image, @quantity, @cost, @status, @unit_type, @created_at)`
  )

  const tx = db.transaction((items) => {
    let count = 0
    for (const r of items) {
      const name = pick(r, ['name', 'Name', 'product_name', 'Product Name'])
      if (!name) continue
      const quantity = num(pick(r, ['quantity', 'Quantity', 'qty', 'Qty', 'weight', 'Weight', 'gaz', 'Gaz']))
      insert.run({
        name: String(name),
        image: null,
        quantity,
        cost: num(pick(r, ['cost', 'Cost', 'net_price', 'net price', 'Net Price', 'price', 'Price'])),
        status: resolveProductStatus(quantity),
        unit_type: normalizeUnitType(pick(r, ['unit_type', 'Unit Type', 'type', 'Type'])),
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

/* -------------------------------------------------------------- expenses */

const getExpenseWalletBalance = () => {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) AS total_added,
      COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) AS total_spent,
      COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) AS balance
    FROM expense_wallet_ledger
  `).get()
  return {
    total_added: num(row?.total_added),
    total_spent: num(row?.total_spent),
    balance: num(row?.balance)
  }
}

const getExpenseWallet = () => {
  const summary = getExpenseWalletBalance()
  const rows = db
    .prepare('SELECT * FROM expense_wallet_ledger ORDER BY datetime(created_at) DESC, id DESC LIMIT 50')
    .all()
  return { ...summary, rows }
}

const addExpenseWalletEntry = ({ type, amount, description = '', method = '', expense_id = null, created_at = nowISO() }) => {
  const value = num(amount)
  if (!['credit', 'debit'].includes(type)) throw new Error('Invalid wallet entry type')
  if (value <= 0) throw new Error('Amount must be greater than 0')

  const info = db.prepare(
    `INSERT INTO expense_wallet_ledger (type, amount, description, method, expense_id, created_at)
     VALUES (@type, @amount, @description, @method, @expense_id, @created_at)`
  ).run({
    type,
    amount: value,
    description,
    method,
    expense_id,
    created_at
  })
  return db.prepare('SELECT * FROM expense_wallet_ledger WHERE id = ?').get(info.lastInsertRowid)
}

const addExpenseBalance = (data = {}) => {
  addExpenseWalletEntry({
    type: 'credit',
    amount: data.amount,
    description: data.description || 'Balance added',
    method: data.method || 'Cash',
    created_at: data.created_at || nowISO()
  })
  return getExpenseWallet()
}

const listExpenses = (filters = {}) => {
  const search = String(filters.search || '').trim()
  const page = Math.max(1, num(filters.page, 1))
  const pageSize = Math.max(1, num(filters.pageSize, 25))
  const where = []
  const params = {}

  if (search) {
    where.push('(title LIKE @search OR notes LIKE @search)')
    params.search = `%${search}%`
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) AS c FROM expenses ${whereSql}`).get(params).c
  const rows = db
    .prepare(`SELECT * FROM expenses ${whereSql} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize })

  return { rows, total, page, pageSize, wallet: getExpenseWalletBalance() }
}

const getExpenseById = (id) => {
  return db.prepare('SELECT * FROM expenses WHERE id = ?').get(id)
}

const createExpense = (data) => {
  const title = String(data.title || '').trim()
  const amount = num(data.amount)
  if (!title) throw new Error('Expense title is required')
  if (amount <= 0) throw new Error('Expense amount must be greater than 0')

  const wallet = getExpenseWalletBalance()
  if (amount > wallet.balance) {
    throw new Error(`Not enough balance. Available: ${wallet.balance}`)
  }

  const created = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO expenses (title, notes, amount, method, created_at)
       VALUES (@title, @notes, @amount, @method, @created_at)`
    ).run({
      title,
      notes: String(data.notes || '').trim(),
      amount,
      method: String(data.method || '').trim(),
      created_at: nowISO()
    })

    const id = info.lastInsertRowid
    addExpenseWalletEntry({
      type: 'debit',
      amount,
      description: `Expense: ${title}`,
      method: data.method || '',
      expense_id: id
    })
    return getExpenseById(id)
  })()

  return created
}

const updateExpense = ({ id, data }) => {
  const title = String(data.title || '').trim()
  if (!title) throw new Error('Expense title is required')

  db.prepare(
    `UPDATE expenses
     SET title = @title, notes = @notes, method = @method
     WHERE id = @id`
  ).run({
    id,
    title,
    notes: String(data.notes || '').trim(),
    method: String(data.method || '').trim()
  })
  return getExpenseById(id)
}

const deleteExpense = (id) => {
  const expense = getExpenseById(id)
  if (!expense) return { ok: true, count: 0 }

  const result = db.transaction(() => {
    db.prepare('DELETE FROM expense_wallet_ledger WHERE expense_id = ?').run(id)
    db.prepare('DELETE FROM expense_ledger WHERE expense_id = ?').run(id)
    return db.prepare('DELETE FROM expenses WHERE id = ?').run(id)
  })()

  return { ok: true, count: result.changes }
}

const deleteExpenses = (ids = []) => {
  const list = [...new Set(ids.map((id) => Number(id)).filter((id) => id > 0))]
  if (!list.length) return { ok: true, count: 0 }
  let count = 0
  db.transaction(() => {
    for (const id of list) {
      count += deleteExpense(id).count
    }
  })()
  return { ok: true, count }
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
  increaseProductsCostByPercent,
  deleteProduct,
  deleteProducts,
  getProductsInventoryTotal,
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
  getExpenseWallet,
  addExpenseBalance,
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  deleteExpenses,
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

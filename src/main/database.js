import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import XLSX from 'xlsx'
import { app, dialog } from 'electron'

let db

function nowISO() {
  return new Date().toISOString()
}

function num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/* ---------------------------------------------------------------- setup */

function resolveDbPath() {
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

function init() {
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
      status        TEXT    NOT NULL DEFAULT 'DONE',
      created_at    TEXT    NOT NULL
    );
  `)

  migrateOrdersSchema()
  migrateOrderArchive()
  migrateOrderItemsSchema()
  migrateProductsSchema()
  migrateAppUser()
  seedIfEmpty()
  return dbPath
}

function migrateAppUser() {
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

function hasAppUser() {
  return !!db.prepare('SELECT 1 FROM app_user WHERE id = 1').get()
}

function getAppUser() {
  return db.prepare('SELECT id, name, email, password_hash, created_at FROM app_user WHERE id = 1').get()
}

function createAppUser({ name, email, passwordHash }) {
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

function getProductById(id) {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id)
}

function listProductsBrief() {
  return db
    .prepare('SELECT id, name, cost, quantity, status FROM products ORDER BY name')
    .all()
}

function getProducts(filters = {}) {
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

function createProduct(data) {
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

function updateProduct({ id, data }) {
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

function deleteProduct(id) {
  db.prepare('DELETE FROM products WHERE id = ?').run(id)
  return { ok: true }
}

function deleteProducts(ids = []) {
  const list = [...new Set(ids.map((id) => Number(id)).filter((id) => id > 0))]
  if (!list.length) return { ok: true, count: 0 }
  const placeholders = list.map(() => '?').join(', ')
  const result = db.prepare(`DELETE FROM products WHERE id IN (${placeholders})`).run(...list)
  return { ok: true, count: result.changes }
}

/* --------------------------------------------------------------- orders */

function isUnset(v) {
  return v === '' || v === null || v === undefined
}

function migrateOrdersSchema() {
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

function migrateOrderArchive() {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name)
  if (!cols.includes('isArchive')) {
    db.exec('ALTER TABLE orders ADD COLUMN isArchive INTEGER NOT NULL DEFAULT 0')
  }
}

function migrateOrderItemsSchema() {
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

function migrateProductsSchema() {
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

function inventoryTotals(items) {
  const totals = new Map()
  for (const item of items) {
    const productId = item.product_id ? num(item.product_id) : null
    if (!productId) continue
    totals.set(productId, (totals.get(productId) || 0) + num(item.quantity, 1))
  }
  return totals
}

function adjustInventory(items, sign) {
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

function restoreInventory(items) {
  adjustInventory(items, 1)
}

function deductInventory(items) {
  adjustInventory(items, -1)
}

function resolveItemPricing(data, existingItem = null) {
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

function mapOrderItem(row) {
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

function attachItems(order) {
  const items = db
    .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
    .all(order.id)
    .map(mapOrderItem)
  return { ...order, items }
}

function getOrderById(id) {
  const order = db.prepare('SELECT id, status, created_at FROM orders WHERE id = ?').get(id)
  if (!order) return null
  return attachItems(order)
}

function normalizeOrderItems(data) {
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

function getOrders(filters = {}) {
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
      `SELECT o.id, o.status, o.created_at
       FROM orders o
       ${whereSql}
       ORDER BY o.id DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize })

  const rows = orders.map(attachItems)
  return { rows, total, page, pageSize }
}

function createOrder(data) {
  const items = normalizeOrderItems(data)
  if (!items.length) throw new Error('Order must include at least one product')

  const status = data.status === 'CANCELLED' ? 'CANCELLED' : 'DONE'
  const created_at = data.created_at || nowISO()

  const insertOrder = db.prepare('INSERT INTO orders (status, created_at, isArchive) VALUES (?, ?, 0)')
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, quantity, total_price, unit_cost, profit)
     VALUES (@order_id, @product_id, @product_name, @quantity, @total_price, @unit_cost, @profit)`
  )

  const orderId = db.transaction(() => {
    const info = insertOrder.run(status, created_at)
    const id = info.lastInsertRowid
    const resolved = items.map((raw) => resolveItemPricing(raw))
    for (const item of resolved) {
      insertItem.run({ order_id: id, ...item })
    }
    if (status === 'DONE') deductInventory(resolved)
    return id
  })()

  return getOrderById(orderId)
}

function updateOrder({ id, data }) {
  const items = normalizeOrderItems(data)
  if (!items.length) throw new Error('Order must include at least one product')

  const status = data.status === 'CANCELLED' ? 'CANCELLED' : 'DONE'
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, quantity, total_price, unit_cost, profit)
     VALUES (@order_id, @product_id, @product_name, @quantity, @total_price, @unit_cost, @profit)`
  )
  const existingOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(id)
  const existingItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id)
  const existingByProduct = new Map(existingItems.map((i) => [i.product_id, i]))

  db.transaction(() => {
    if (existingOrder?.status === 'DONE') restoreInventory(existingItems)

    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id)
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
  })()

  return getOrderById(id)
}

function deleteOrder(id) {
  const order = db.prepare('SELECT status FROM orders WHERE id = ? AND isArchive = 0').get(id)
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id)

  db.transaction(() => {
    if (order?.status === 'DONE') restoreInventory(items)
    db.prepare('UPDATE orders SET isArchive = 1 WHERE id = ? AND isArchive = 0').run(id)
  })()

  return { ok: true, count: order ? 1 : 0 }
}

function deleteOrders(ids = []) {
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
      const result = db.prepare('UPDATE orders SET isArchive = 1 WHERE isArchive = 0 AND id = ?').run(id)
      count += result.changes
    }
  })()

  return { ok: true, count }
}

/* ------------------------------------------------------------ dashboard */
// Only DONE orders count toward sales / profit / items sold.

function parseIsoDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toIsoDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function daysInRange(start, end) {
  const a = parseIsoDate(start)
  const b = parseIsoDate(end)
  return Math.round((b - a) / 86400000) + 1
}

function addDaysIso(iso, n) {
  const d = parseIsoDate(iso)
  d.setDate(d.getDate() + n)
  return toIsoDate(d)
}

function previousPeriodDates(start, end) {
  const days = daysInRange(start, end)
  const prevEnd = addDaysIso(start, -1)
  const prevStart = addDaysIso(prevEnd, -(days - 1))
  return { startDate: prevStart, endDate: prevEnd, days }
}

function fillSeriesGaps(rows, startDate, endDate) {
  if (!startDate || !endDate) return rows
  const byDate = {}
  rows.forEach((r) => { byDate[r.date] = r })
  const result = []
  for (let d = startDate; d <= endDate; d = addDaysIso(d, 1)) {
    result.push(byDate[d] || { date: d, sales: 0, profit: 0, items: 0 })
  }
  return result
}

function normalizeProductIds(filters = {}) {
  const raw = filters.productIds
  if (raw == null || raw === '') return []
  const list = Array.isArray(raw) ? raw : [raw]
  return [...new Set(list.map((id) => Number(id)).filter((id) => id > 0))]
}

function productIdsFilter(filters, params, alias = 'i') {
  const ids = normalizeProductIds(filters)
  if (!ids.length) return ''
  const placeholders = ids.map((_, idx) => `@pid${idx}`).join(', ')
  ids.forEach((id, idx) => { params[`pid${idx}`] = id })
  return ` AND ${alias}.product_id IN (${placeholders})`
}

function dashboardBaseWhere(filters, params) {
  const where = ["o.status = 'DONE'", 'o.isArchive = 0']

  if (filters.startDate) {
    where.push('date(o.created_at) >= date(@startDate)')
    params.startDate = filters.startDate
  }
  if (filters.endDate) {
    where.push('date(o.created_at) <= date(@endDate)')
    params.endDate = filters.endDate
  }

  return where
}

function getOrderTotalsForRange(startDate, endDate, filters = {}) {
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

function getDashboard(filters = {}) {
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

async function exportProducts() {
  const rows = db
    .prepare(
      `SELECT id AS product_number, name, quantity, cost, status, created_at
       FROM products ORDER BY id`
    )
    .all()
  return writeSheet(rows, 'Products', 'products.xlsx')
}

async function exportOrders() {
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

async function writeSheet(rows, sheetName, defaultName) {
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

async function importProducts() {
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

/* ----------------------------------------------------------------- seed */

function seedIfEmpty() {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM products').get().c
  if (existing > 0) return

  const sampleProducts = [
    { name: 'Coca Cola 500ml', quantity: 120, cost: 80, status: 'in_stock' },
    { name: 'Lay\'s Chips Salted', quantity: 60, cost: 50, status: 'in_stock' },
    { name: 'Nestle Water 1.5L', quantity: 0, cost: 70, status: 'out_of_stock' },
    { name: 'Dairy Milk Chocolate', quantity: 40, cost: 150, status: 'in_stock' },
    { name: 'Sunsilk Shampoo 200ml', quantity: 25, cost: 320, status: 'in_stock' },
    { name: 'Surf Excel 1kg', quantity: 18, cost: 540, status: 'in_stock' }
  ]

  const insertP = db.prepare(
    `INSERT INTO products (name, image, quantity, cost, status, created_at)
     VALUES (@name, @image, @quantity, @cost, @status, @created_at)`
  )
  const created = []
  db.transaction(() => {
    for (const p of sampleProducts) {
      const info = insertP.run({ ...p, image: null, created_at: nowISO() })
      created.push({ id: info.lastInsertRowid, ...p })
    }
  })()

  const insertO = db.prepare('INSERT INTO orders (status, created_at, isArchive) VALUES (@status, @created_at, 0)')
  const insertI = db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, quantity, total_price, unit_cost, profit)
     VALUES (@order_id, @product_id, @product_name, @quantity, @total_price, @unit_cost, @profit)`
  )
  db.transaction(() => {
    for (let d = 13; d >= 0; d--) {
      const day = new Date()
      day.setDate(day.getDate() - d)
      const ordersToday = 1 + Math.floor(Math.random() * 4)
      for (let k = 0; k < ordersToday; k++) {
        const status = Math.random() < 0.1 ? 'CANCELLED' : 'DONE'
        const info = insertO.run({ status, created_at: day.toISOString() })
        const lineCount = 1 + Math.floor(Math.random() * 2)
        const picked = new Set()
        for (let n = 0; n < lineCount; n++) {
          const p = created[Math.floor(Math.random() * created.length)]
          if (picked.has(p.id)) continue
          picked.add(p.id)
          const qty = 1 + Math.floor(Math.random() * 5)
          const markup = 5 + Math.floor(Math.random() * 25)
          const totalPrice = (p.cost + markup) * qty
          const profit = totalPrice - p.cost * qty
          insertI.run({
            order_id: info.lastInsertRowid,
            product_id: p.id,
            product_name: p.name,
            quantity: qty,
            total_price: totalPrice,
            unit_cost: p.cost,
            profit
          })
        }
      }
    }
  })()
}

function backupTo(destPath) {
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
  getOrders,
  createOrder,
  updateOrder,
  deleteOrder,
  deleteOrders,
  getDashboard,
  exportProducts,
  exportOrders,
  importProducts
}

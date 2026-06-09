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

function init() {
  const dbPath = path.join(app.getPath('userData'), 'pos.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = DELETE')

  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      image       TEXT,
      quantity    INTEGER NOT NULL DEFAULT 0,
      net_price   REAL    NOT NULL DEFAULT 0,
      margin      REAL    NOT NULL DEFAULT 0,
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

  seedIfEmpty()
  return dbPath
}

/* ------------------------------------------------------------- products */

function getProductById(id) {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id)
}

function listProductsBrief() {
  return db
    .prepare('SELECT id, name, net_price, margin FROM products ORDER BY name')
    .all()
}

function getProducts(filters = {}) {
  const search = filters.search || ''
  const status = filters.status || ''
  const priceOp = filters.priceOp || ''
  const priceValue = filters.priceValue
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
  if (priceOp && priceValue !== '' && priceValue !== null && priceValue !== undefined && Number.isFinite(Number(priceValue))) {
    const op = priceOp === 'gt' ? '>' : priceOp === 'lt' ? '<' : '='
    where.push(`net_price ${op} @priceValue`)
    params.priceValue = Number(priceValue)
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
      `INSERT INTO products (name, image, quantity, net_price, margin, status, created_at)
       VALUES (@name, @image, @quantity, @net_price, @margin, @status, @created_at)`
    )
    .run({
      name: data.name || 'Unnamed product',
      image: data.image || null,
      quantity: num(data.quantity),
      net_price: num(data.net_price),
      margin: num(data.margin),
      status: data.status === 'out_of_stock' ? 'out_of_stock' : 'in_stock',
      created_at: nowISO()
    })
  return getProductById(info.lastInsertRowid)
}

function updateProduct({ id, data }) {
  db.prepare(
    `UPDATE products
     SET name = @name, image = @image, quantity = @quantity,
         net_price = @net_price, margin = @margin, status = @status
     WHERE id = @id`
  ).run({
    id,
    name: data.name || 'Unnamed product',
    image: data.image || null,
    quantity: num(data.quantity),
    net_price: num(data.net_price),
    margin: num(data.margin),
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

function getOrderById(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id)
}

function getOrders(filters = {}) {
  const page = Math.max(1, num(filters.page, 1))
  const pageSize = Math.max(1, num(filters.pageSize, 25))

  const where = []
  const params = {}

  if (filters.orderId) {
    where.push('id = @orderId')
    params.orderId = num(filters.orderId)
  }
  if (filters.productId) {
    where.push('product_id = @productId')
    params.productId = num(filters.productId)
  }
  if (filters.productName) {
    where.push('product_name LIKE @productName')
    params.productName = `%${filters.productName}%`
  }
  if (filters.status) {
    where.push('status = @status')
    params.status = filters.status
  }
  if (filters.startDate) {
    where.push('date(created_at) >= date(@startDate)')
    params.startDate = filters.startDate
  }
  if (filters.endDate) {
    where.push('date(created_at) <= date(@endDate)')
    params.endDate = filters.endDate
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) AS c FROM orders ${whereSql}`).get(params).c
  const rows = db
    .prepare(`SELECT * FROM orders ${whereSql} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize })

  return { rows, total, page, pageSize }
}

function createOrder(data) {
  let price = data.price
  let margin = data.margin
  let productName = data.product_name
  const productId = data.product_id ? num(data.product_id) : null

  // Auto-fill price / margin / name from the linked product when not provided.
  if (productId) {
    const p = getProductById(productId)
    if (p) {
      if (price === '' || price === null || price === undefined) price = p.net_price
      if (margin === '' || margin === null || margin === undefined) margin = p.margin
      if (!productName) productName = p.name
    }
  }

  const info = db
    .prepare(
      `INSERT INTO orders (product_id, product_name, quantity, price, margin, status, created_at)
       VALUES (@product_id, @product_name, @quantity, @price, @margin, @status, @created_at)`
    )
    .run({
      product_id: productId,
      product_name: productName || '',
      quantity: num(data.quantity, 1),
      price: num(price),
      margin: num(margin),
      status: data.status === 'CANCELLED' ? 'CANCELLED' : 'DONE',
      created_at: data.created_at || nowISO()
    })
  return getOrderById(info.lastInsertRowid)
}

function updateOrder({ id, data }) {
  let price = data.price
  let margin = data.margin
  let productName = data.product_name
  const productId = data.product_id ? num(data.product_id) : null

  if (productId) {
    const p = getProductById(productId)
    if (p) {
      if (price === '' || price === null || price === undefined) price = p.net_price
      if (margin === '' || margin === null || margin === undefined) margin = p.margin
      if (!productName) productName = p.name
    }
  }

  db.prepare(
    `UPDATE orders
     SET product_id = @product_id, product_name = @product_name, quantity = @quantity,
         price = @price, margin = @margin, status = @status
     WHERE id = @id`
  ).run({
    id,
    product_id: productId,
    product_name: productName || '',
    quantity: num(data.quantity, 1),
    price: num(price),
    margin: num(margin),
    status: data.status === 'CANCELLED' ? 'CANCELLED' : 'DONE'
  })
  return getOrderById(id)
}

function deleteOrder(id) {
  db.prepare('DELETE FROM orders WHERE id = ?').run(id)
  return { ok: true }
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

function getOrderTotalsForRange(startDate, endDate) {
  const where = ["status = 'DONE'"]
  const params = {}

  if (startDate) {
    where.push('date(created_at) >= date(@startDate)')
    params.startDate = startDate
  }
  if (endDate) {
    where.push('date(created_at) <= date(@endDate)')
    params.endDate = endDate
  }

  const whereSql = 'WHERE ' + where.join(' AND ')
  const row = db
    .prepare(
      `SELECT SUM(price * quantity)  AS sales,
              SUM(margin * quantity) AS profit,
              SUM(quantity)          AS items
       FROM orders ${whereSql}`
    )
    .get(params)

  return {
    sales: num(row.sales),
    profit: num(row.profit),
    items: num(row.items)
  }
}

function getDashboard(filters = {}) {
  const where = ["status = 'DONE'"]
  const params = {}

  if (filters.startDate) {
    where.push('date(created_at) >= date(@startDate)')
    params.startDate = filters.startDate
  }
  if (filters.endDate) {
    where.push('date(created_at) <= date(@endDate)')
    params.endDate = filters.endDate
  }

  const whereSql = 'WHERE ' + where.join(' AND ')
  const series = db
    .prepare(
      `SELECT date(created_at) AS date,
              SUM(price * quantity)  AS sales,
              SUM(margin * quantity) AS profit,
              SUM(quantity)          AS items
       FROM orders ${whereSql}
       GROUP BY date(created_at)
       ORDER BY date(created_at)`
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
    previousTotals = getOrderTotalsForRange(previousPeriod.startDate, previousPeriod.endDate)
  }

  return { series: filledSeries, totals, previousTotals, previousPeriod }
}

/* --------------------------------------------------------- excel import/export */

async function exportProducts() {
  const rows = db
    .prepare(
      `SELECT id AS product_number, name, quantity, net_price, margin, status, created_at
       FROM products ORDER BY id`
    )
    .all()
  return writeSheet(rows, 'Products', 'products.xlsx')
}

async function exportOrders() {
  const rows = db
    .prepare(
      `SELECT id AS order_number, product_id, product_name, quantity, price, margin,
              (price * quantity) AS total, status, created_at
       FROM orders ORDER BY id`
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
    `INSERT INTO products (name, image, quantity, net_price, margin, status, created_at)
     VALUES (@name, @image, @quantity, @net_price, @margin, @status, @created_at)`
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
        net_price: num(pick(r, ['net_price', 'net price', 'Net Price', 'price', 'Price'])),
        margin: num(pick(r, ['margin', 'Margin', 'profit', 'Profit'])),
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
    { name: 'Coca Cola 500ml', quantity: 120, net_price: 80, margin: 20, status: 'in_stock' },
    { name: 'Lay\'s Chips Salted', quantity: 60, net_price: 50, margin: 15, status: 'in_stock' },
    { name: 'Nestle Water 1.5L', quantity: 0, net_price: 70, margin: 18, status: 'out_of_stock' },
    { name: 'Dairy Milk Chocolate', quantity: 40, net_price: 150, margin: 40, status: 'in_stock' },
    { name: 'Sunsilk Shampoo 200ml', quantity: 25, net_price: 320, margin: 70, status: 'in_stock' },
    { name: 'Surf Excel 1kg', quantity: 18, net_price: 540, margin: 110, status: 'in_stock' }
  ]

  const insertP = db.prepare(
    `INSERT INTO products (name, image, quantity, net_price, margin, status, created_at)
     VALUES (@name, @image, @quantity, @net_price, @margin, @status, @created_at)`
  )
  const created = []
  db.transaction(() => {
    for (const p of sampleProducts) {
      const info = insertP.run({ ...p, image: null, created_at: nowISO() })
      created.push({ id: info.lastInsertRowid, ...p })
    }
  })()

  const insertO = db.prepare(
    `INSERT INTO orders (product_id, product_name, quantity, price, margin, status, created_at)
     VALUES (@product_id, @product_name, @quantity, @price, @margin, @status, @created_at)`
  )
  db.transaction(() => {
    for (let d = 13; d >= 0; d--) {
      const day = new Date()
      day.setDate(day.getDate() - d)
      const ordersToday = 1 + Math.floor(Math.random() * 4)
      for (let k = 0; k < ordersToday; k++) {
        const p = created[Math.floor(Math.random() * created.length)]
        const qty = 1 + Math.floor(Math.random() * 5)
        insertO.run({
          product_id: p.id,
          product_name: p.name,
          quantity: qty,
          price: p.net_price,
          margin: p.margin,
          status: Math.random() < 0.1 ? 'CANCELLED' : 'DONE',
          created_at: day.toISOString()
        })
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
  getDashboard,
  exportProducts,
  exportOrders,
  importProducts
}

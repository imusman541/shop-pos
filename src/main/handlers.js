import * as db from './database'
import * as auth from './auth'
import { runBackupNow } from './backup'

export const registerHandlers = (ipcMain) => {
  // Auth
  ipcMain.handle('auth:status', () => auth.getAuthStatus())
  ipcMain.handle('auth:signUp', (_e, data) => auth.signUp(data))
  ipcMain.handle('auth:signIn', (_e, data) => auth.signIn(data))
  ipcMain.handle('auth:signOut', () => auth.signOut())

  // Products
  ipcMain.handle('products:get', (_e, filters) => db.getProducts(filters))
  ipcMain.handle('products:getById', (_e, id) => db.getProductById(id))
  ipcMain.handle('products:listBrief', () => db.listProductsBrief())
  ipcMain.handle('products:create', (_e, data) => db.createProduct(data))
  ipcMain.handle('products:update', (_e, payload) => db.updateProduct(payload))
  ipcMain.handle('products:delete', (_e, id) => db.deleteProduct(id))
  ipcMain.handle('products:deleteMany', (_e, ids) => db.deleteProducts(ids))
  ipcMain.handle('products:increaseCostByPercent', (_e, payload) => db.increaseProductsCostByPercent(payload))
  ipcMain.handle('products:export', () => db.exportProducts())
  ipcMain.handle('products:import', () => db.importProducts())

  // Customers / Khata
  ipcMain.handle('customers:get', (_e, filters) => db.listCustomers(filters))
  ipcMain.handle('customers:listBrief', () => db.listCustomersBrief())
  ipcMain.handle('customers:getKhata', (_e, payload) => {
    const id = typeof payload === 'object' ? payload.id : payload
    const filters = typeof payload === 'object' ? payload : {}
    return db.getCustomerKhata(id, filters)
  })
  ipcMain.handle('customers:create', (_e, data) => db.createCustomer(data))
  ipcMain.handle('customers:update', (_e, payload) => db.updateCustomer(payload))
  ipcMain.handle('customers:delete', (_e, id) => db.deleteCustomer(id))
  ipcMain.handle('customers:deleteMany', (_e, ids) => db.deleteCustomers(ids))
  ipcMain.handle('customers:deleteKhataEntries', (_e, payload) => db.deleteCustomerLedgerEntries(payload))
  ipcMain.handle('customers:payment', (_e, payload) => db.receiveCustomerPayment(payload))
  ipcMain.handle('customers:charge', (_e, payload) => db.addCustomerCharge(payload))
  ipcMain.handle('customers:payable', (_e, payload) => db.addCustomerPayable(payload))
  ipcMain.handle('customers:exportKhata', (_e, payload) => db.exportCustomerKhata(payload.id, payload.entryIds))
  ipcMain.handle('customers:shareKhataWhatsApp', (_e, payload) => db.shareCustomerKhataOnWhatsApp(payload.id, payload.entryIds))

  // Vendors / Supplier Khata
  ipcMain.handle('vendors:get', (_e, filters) => db.listVendors(filters))
  ipcMain.handle('vendors:getKhata', (_e, id) => db.getVendorKhata(id))
  ipcMain.handle('vendors:create', (_e, data) => db.createVendor(data))
  ipcMain.handle('vendors:update', (_e, payload) => db.updateVendor(payload))
  ipcMain.handle('vendors:delete', (_e, id) => db.deleteVendor(id))
  ipcMain.handle('vendors:deleteMany', (_e, ids) => db.deleteVendors(ids))
  ipcMain.handle('vendors:deleteKhataEntries', (_e, payload) => db.deleteVendorLedgerEntries(payload))
  ipcMain.handle('vendors:purchase', (_e, payload) => db.addVendorPurchase(payload))
  ipcMain.handle('vendors:payment', (_e, payload) => db.payVendor(payload))

  // Expenses
  ipcMain.handle('expenses:get', (_e, filters) => db.listExpenses(filters))
  ipcMain.handle('expenses:getWallet', () => db.getExpenseWallet())
  ipcMain.handle('expenses:addBalance', (_e, data) => db.addExpenseBalance(data))
  ipcMain.handle('expenses:create', (_e, data) => db.createExpense(data))
  ipcMain.handle('expenses:update', (_e, payload) => db.updateExpense(payload))
  ipcMain.handle('expenses:delete', (_e, id) => db.deleteExpense(id))
  ipcMain.handle('expenses:deleteMany', (_e, ids) => db.deleteExpenses(ids))

  // Orders
  ipcMain.handle('orders:get', (_e, filters) => db.getOrders(filters))
  ipcMain.handle('orders:create', (_e, data) => db.createOrder(data))
  ipcMain.handle('orders:update', (_e, payload) => db.updateOrder(payload))
  ipcMain.handle('orders:delete', (_e, id) => db.deleteOrder(id))
  ipcMain.handle('orders:deleteMany', (_e, ids) => db.deleteOrders(ids))
  ipcMain.handle('orders:export', () => db.exportOrders())
  ipcMain.handle('backup:now', () => runBackupNow())
  // Dashboard
  ipcMain.handle('dashboard:get', (_e, filters) => db.getDashboard(filters))
}

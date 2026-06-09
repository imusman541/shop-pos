import * as db from './database'
import { runBackupNow } from './backup'
export function registerHandlers(ipcMain) {
  // Products
  ipcMain.handle('products:get', (_e, filters) => db.getProducts(filters))
  ipcMain.handle('products:getById', (_e, id) => db.getProductById(id))
  ipcMain.handle('products:listBrief', () => db.listProductsBrief())
  ipcMain.handle('products:create', (_e, data) => db.createProduct(data))
  ipcMain.handle('products:update', (_e, payload) => db.updateProduct(payload))
  ipcMain.handle('products:delete', (_e, id) => db.deleteProduct(id))
  ipcMain.handle('products:deleteMany', (_e, ids) => db.deleteProducts(ids))
  ipcMain.handle('products:export', () => db.exportProducts())
  ipcMain.handle('products:import', () => db.importProducts())

  // Orders
  ipcMain.handle('orders:get', (_e, filters) => db.getOrders(filters))
  ipcMain.handle('orders:create', (_e, data) => db.createOrder(data))
  ipcMain.handle('orders:update', (_e, payload) => db.updateOrder(payload))
  ipcMain.handle('orders:delete', (_e, id) => db.deleteOrder(id))
  ipcMain.handle('orders:export', () => db.exportOrders())
  ipcMain.handle('backup:now', () => runBackupNow())
  // Dashboard
  ipcMain.handle('dashboard:get', (_e, filters) => db.getDashboard(filters))
}

'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const api = {
  // Products
  getProducts: (filters) => ipcRenderer.invoke('products:get', filters),
  getProductById: (id) => ipcRenderer.invoke('products:getById', id),
  listProductsBrief: () => ipcRenderer.invoke('products:listBrief'),
  createProduct: (data) => ipcRenderer.invoke('products:create', data),
  updateProduct: (id, data) => ipcRenderer.invoke('products:update', { id, data }),
  deleteProduct: (id) => ipcRenderer.invoke('products:delete', id),
  deleteProducts: (ids) => ipcRenderer.invoke('products:deleteMany', ids),
  exportProducts: () => ipcRenderer.invoke('products:export'),
  importProducts: () => ipcRenderer.invoke('products:import'),

  // Orders
  getOrders: (filters) => ipcRenderer.invoke('orders:get', filters),
  createOrder: (data) => ipcRenderer.invoke('orders:create', data),
  updateOrder: (id, data) => ipcRenderer.invoke('orders:update', { id, data }),
  deleteOrder: (id) => ipcRenderer.invoke('orders:delete', id),
  deleteOrders: (ids) => ipcRenderer.invoke('orders:deleteMany', ids),
  exportOrders: () => ipcRenderer.invoke('orders:export'),

  // Dashboard
  getDashboard: (filters) => ipcRenderer.invoke('dashboard:get', filters),
  backupNow: () => ipcRenderer.invoke('backup:now')
}

contextBridge.exposeInMainWorld('api', api)

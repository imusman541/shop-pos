'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const api = {
  // Auth
  authStatus: () => ipcRenderer.invoke('auth:status'),
  signUp: (data) => ipcRenderer.invoke('auth:signUp', data),
  signIn: (data) => ipcRenderer.invoke('auth:signIn', data),
  signOut: () => ipcRenderer.invoke('auth:signOut'),

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

  // Customers / Khata
  getCustomers: (filters) => ipcRenderer.invoke('customers:get', filters),
  listCustomersBrief: () => ipcRenderer.invoke('customers:listBrief'),
  getCustomerKhata: (id) => ipcRenderer.invoke('customers:getKhata', id),
  createCustomer: (data) => ipcRenderer.invoke('customers:create', data),
  updateCustomer: (id, data) => ipcRenderer.invoke('customers:update', { id, data }),
  deleteCustomer: (id) => ipcRenderer.invoke('customers:delete', id),
  deleteCustomers: (ids) => ipcRenderer.invoke('customers:deleteMany', ids),
  deleteCustomerKhataEntries: (id, entryIds) => ipcRenderer.invoke('customers:deleteKhataEntries', { id, entryIds }),
  receiveCustomerPayment: (id, data) => ipcRenderer.invoke('customers:payment', { id, data }),
  addCustomerCharge: (id, data) => ipcRenderer.invoke('customers:charge', { id, data }),
  addCustomerPayable: (id, data) => ipcRenderer.invoke('customers:payable', { id, data }),
  exportCustomerKhata: (id, entryIds = []) => ipcRenderer.invoke('customers:exportKhata', { id, entryIds }),
  shareCustomerKhataOnWhatsApp: (id, entryIds = []) => ipcRenderer.invoke('customers:shareKhataWhatsApp', { id, entryIds }),

  // Expenses
  getExpenses: (filters) => ipcRenderer.invoke('expenses:get', filters),
  getExpenseWallet: () => ipcRenderer.invoke('expenses:getWallet'),
  addExpenseBalance: (data) => ipcRenderer.invoke('expenses:addBalance', data),
  createExpense: (data) => ipcRenderer.invoke('expenses:create', data),
  updateExpense: (id, data) => ipcRenderer.invoke('expenses:update', { id, data }),
  deleteExpense: (id) => ipcRenderer.invoke('expenses:delete', id),
  deleteExpenses: (ids) => ipcRenderer.invoke('expenses:deleteMany', ids),

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

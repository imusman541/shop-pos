import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import * as db from './database'
import { registerHandlers } from './handlers'
import { scheduleBackups, runBackupNow } from './backup'

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f1720',
    title: 'Alizeh Foam',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // Open external links in the user's browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Dev: electron-vite sets process.env.ELECTRON_RENDERER_URL when you run `npm run dev`
  // (e.g. http://127.0.0.1:5173/) so the window loads the Vite dev server with hot reload.
  // Production / preview: unset → load the built HTML from disk instead.
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  db.init()
  registerHandlers(ipcMain)
  createWindow()
  scheduleBackups()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitting = false

app.on('before-quit', async (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  try {
    await runBackupNow()
  } catch (err) {
    console.error('[backup] final backup failed:', err)
  }
  app.exit(0)
})

import { app, BrowserWindow, ipcMain, shell, nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'
import * as db from './database'
import { registerHandlers } from './handlers'
import { scheduleBackups, runBackupNow } from './backup'

const APP_NAME = 'Alizeh Foam'
const USER_DATA_DIR = 'shop-pos'

// Display name for dock / menu; data folder stays fixed so the DB path never moves.
app.setName(APP_NAME)
app.setPath('userData', path.join(app.getPath('appData'), USER_DATA_DIR))

const resolveIconPath = () => {
  const candidates = [
    path.join(__dirname, '../../build/icon.png'),
    path.join(app.getAppPath(), 'build/icon.png')
  ]
  return candidates.find((p) => fs.existsSync(p)) || null
}

const loadAppIcon = () => {
  const iconPath = resolveIconPath()
  if (!iconPath) return null
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) return null
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(image)
  }
  return image
}

const createWindow = () => {
  const icon = loadAppIcon()
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f1720',
    title: APP_NAME,
    icon: icon || undefined,
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

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFile } from 'child_process'
import { backupTo } from './database'

/* ------------------------------------------------------------------ config
 * Edit these to control backup behaviour. Everything works locally with the
 * defaults. Cloud/Git options are OPT-IN.
 * -------------------------------------------------------------------------- */
const CONFIG = {
  intervalMinutes: 30, // how often to auto-backup while the app is open
  keepCopies: 10, // how many timestamped copies to keep before pruning

  // RECOMMENDED easy "cloud" backup: point this at a synced folder
  // (iCloud Drive / Google Drive / Dropbox / OneDrive). Leave '' to disable.
  // e.g. '/Users/you/Library/Mobile Documents/com~apple~CloudDocs/ShopPOS-Backups'
  externalBackupDir: '',

  // Advanced: push the backup file to a GitHub repo. Requires git installed,
  // a repo already cloned/initialised at repoDir with a remote + working auth.
  git: {
    enabled: false,
    repoDir: '', // absolute path to the git repo folder
    branch: 'main',
    commitPrefix: 'POS backup'
  }
}

let running = false
let timer = null

const backupsDir = () => path.join(app.getPath('userData'), 'backups')
const latestPath = () => path.join(app.getPath('userData'), 'pos-backup.db')

const stamp = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

const prune = (dir) => {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^pos-backup-.*\.db$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const old of files.slice(CONFIG.keepCopies)) {
      fs.unlinkSync(path.join(dir, old.f))
    }
  } catch (e) {
    console.error('[backup] prune failed:', e.message)
  }
}

const run = (cmd, args, cwd) => {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout)
    })
  })
}

const pushToGit = async (sourceFile) => {
  const { repoDir, branch, commitPrefix } = CONFIG.git
  if (!repoDir || !fs.existsSync(repoDir)) {
    return { ok: false, reason: 'git repoDir not found' }
  }
  try {
    fs.copyFileSync(sourceFile, path.join(repoDir, 'pos-backup.db'))
    await run('git', ['add', 'pos-backup.db'], repoDir)
    try {
      await run('git', ['commit', '-m', `${commitPrefix} ${new Date().toISOString()}`], repoDir)
    } catch (e) {
      if (/nothing to commit/i.test(e.message)) return { ok: true, skipped: true }
      throw e
    }
    await run('git', ['push', 'origin', branch], repoDir)
    return { ok: true }
  } catch (e) {
    console.error('[backup] git push failed:', e.message)
    return { ok: false, reason: e.message }
  }
}

export const runBackupNow = async () => {
  if (running) return { ok: false, reason: 'A backup is already in progress' }
  running = true
  try {
    const dir = backupsDir()
    ensureDir(dir)

    const dest = path.join(dir, `pos-backup-${stamp()}.db`)
    await backupTo(dest) // clean, consistent snapshot (folds in WAL)
    fs.copyFileSync(dest, latestPath()) // stable "latest" copy
    prune(dir)

    if (CONFIG.externalBackupDir) {
      try {
        ensureDir(CONFIG.externalBackupDir)
        fs.copyFileSync(dest, path.join(CONFIG.externalBackupDir, 'pos-backup.db'))
      } catch (e) {
        console.error('[backup] external copy failed:', e.message)
      }
    }

    let git = null
    if (CONFIG.git.enabled) git = await pushToGit(dest)

    console.log('[backup] saved:', dest)
    return { ok: true, file: dest, latest: latestPath(), git }
  } catch (e) {
    console.error('[backup] failed:', e.message)
    return { ok: false, reason: e.message }
  } finally {
    running = false
  }
}

export const scheduleBackups = () => {
  setTimeout(() => runBackupNow(), 5000) // shortly after launch
  if (timer) clearInterval(timer)
  timer = setInterval(() => runBackupNow(), CONFIG.intervalMinutes * 60 * 1000)
}
import crypto from 'crypto'
import * as db from './database'

let session = null

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT_OPTS)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = crypto.scryptSync(password, salt, 64, SCRYPT_OPTS)
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(expected, actual)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function validateEmail(email) {
  const value = String(email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(value)) {
    throw new Error('Email is not correct')
  }
  return value
}

function validatePassword(password) {
  const value = String(password || '')
  if (value.length < 6) throw new Error('Password must be at least 6 characters')
  return value
}

function validateName(name) {
  const value = String(name || '').trim()
  if (!value) throw new Error('Name is required')
  return value
}

function toSession(user) {
  return { name: user.name, email: user.email }
}

export function getAuthStatus() {
  return {
    hasAccount: db.hasAppUser(),
    session: session ? { ...session } : null
  }
}

export function signUp({ name, email, password }) {
  if (db.hasAppUser()) throw new Error('Account already created')

  const cleanName = validateName(name)
  const cleanEmail = validateEmail(email)
  const cleanPassword = validatePassword(password)
  const passwordHash = hashPassword(cleanPassword)

  const user = db.createAppUser({
    name: cleanName,
    email: cleanEmail,
    passwordHash
  })

  session = toSession(user)
  return session
}

export function signIn({ email, password }) {
  const user = db.getAppUser()
  if (!user) throw new Error('No account found. Create an account first.')

  const cleanEmail = validateEmail(email)
  const cleanPassword = validatePassword(password)

  if (user.email !== cleanEmail) throw new Error('Invalid email or password')
  if (!verifyPassword(cleanPassword, user.password_hash)) {
    throw new Error('Invalid email or password')
  }

  session = toSession(user)
  return session
}

export function signOut() {
  session = null
}

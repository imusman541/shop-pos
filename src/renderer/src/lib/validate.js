const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const isValidEmail = (email) => {
  return EMAIL_RE.test(String(email || '').trim())
}

export const emailError = (email) => {
  const value = String(email || '').trim()
  if (!value) return 'Email is required'
  if (!isValidEmail(value)) return 'Email is not correct'
  return null
}

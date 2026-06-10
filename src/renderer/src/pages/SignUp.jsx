import React, { useState } from 'react'
import { useToast } from '../components/Toast'
import { emailError } from '../lib/validate'

export default function SignUp({ onSuccess }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const emailErr = emailError(email)
    if (emailErr) {
      toast(emailErr)
      return
    }
    setSaving(true)
    try {
      const session = await window.api.signUp({ name, email, password })
      toast('Account created')
      onSuccess(session)
    } catch (err) {
      toast(err.message || 'Could not create account')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="signup-name">Name</label>
        <input
          id="signup-name"
          type="text"
          autoComplete="name"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="signup-password">Password</label>
        <input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 6 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
      </div>
      <button className="btn btn-primary auth-submit" type="submit" disabled={saving}>
        {saving ? <span className="spinner" /> : 'Create account'}
      </button>
    </form>
  )
}

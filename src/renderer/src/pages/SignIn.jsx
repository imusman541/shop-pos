import React, { useState } from 'react'
import { useToast } from '../components/Toast'
import { emailError } from '../lib/validate'

const SignIn = ({ onSuccess }) => {
  const toast = useToast()
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
      const session = await window.api.signIn({ email, password })
      onSuccess(session)
    } catch (err) {
      toast(err.message || 'Could not sign in')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="signin-email">Email</label>
        <input
          id="signin-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="signin-password">Password</label>
        <input
          id="signin-password"
          type="password"
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <button className="btn btn-primary auth-submit" type="submit" disabled={saving}>
        {saving ? <span className="spinner" /> : 'Sign in'}
      </button>
    </form>
  )
}

export default SignIn;

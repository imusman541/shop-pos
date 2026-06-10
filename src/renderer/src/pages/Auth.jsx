import React from 'react'
import SignIn from './SignIn'
import SignUp from './SignUp'

export default function Auth({ hasAccount, onAuth }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="./app-icon.png" alt="" className="brand-logo" width="40" height="40" />
          <div>
            <div className="name">Alizeh Foam</div>
            <div className="sub">Point of Sale</div>
          </div>
        </div>

        <h1>{hasAccount ? 'Sign in' : 'Create account'}</h1>
        <p className="auth-lead">
          {hasAccount
            ? 'Enter your email and password to open the POS.'
            : 'Set up the owner account for this computer. Only one account can be created.'}
        </p>

        {hasAccount ? (
          <SignIn onSuccess={onAuth} />
        ) : (
          <SignUp onSuccess={onAuth} />
        )}
      </div>
    </div>
  )
}

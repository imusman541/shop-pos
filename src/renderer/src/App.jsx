import React, { useEffect, useState } from 'react'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import Orders from './pages/Orders'
import Auth from './pages/Auth'
import { ToastProvider } from './components/Toast'
import { IconDashboard, IconBox, IconCart, IconLogout } from './components/icons'
import BackupButton from './components/BackupButton'

const NAV = [
  { key: 'dashboard', label: 'Dashboard', Icon: IconDashboard, Page: Dashboard },
  { key: 'products', label: 'Inventory', Icon: IconBox, Page: Products },
  { key: 'orders', label: 'Orders', Icon: IconCart, Page: Orders }
]

const App = () => {
  const [active, setActive] = useState('dashboard')
  const [auth, setAuth] = useState(null)

  useEffect(() => {
    window.api.authStatus().then(setAuth)
  }, [])

  const handleAuth = (session) => {
    setAuth({ hasAccount: true, session })
  }

  const logout = async () => {
    await window.api.signOut()
    setAuth((prev) => ({ ...prev, session: null }))
  }

  if (!auth) {
    return (
      <div className="auth-loading">
        <span className="spinner" />
      </div>
    )
  }

  if (!auth.session) {
    return (
      <ToastProvider>
        <Auth hasAccount={auth.hasAccount} onAuth={handleAuth} />
      </ToastProvider>
    )
  }

  const Current = NAV.find((n) => n.key === active).Page

  return (
    <ToastProvider>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <img src="./app-icon.png" alt="" className="brand-logo" width="34" height="34" />
            <div>
              <div className="name">Alizeh Foam</div>
              <div className="sub">Point of Sale</div>
            </div>
          </div>

          <nav className="nav">
            {NAV.map(({ key, label, Icon }) => (
              <button
                key={key}
                className={active === key ? 'active' : ''}
                onClick={() => setActive(key)}
              >
                <Icon />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="foot">
            <div className="user-card">
              <div className="user-avatar">{auth.session.name.charAt(0).toUpperCase()}</div>
              <div className="user-meta">
                <div className="user-name">{auth.session.name}</div>
                <div className="user-email">{auth.session.email}</div>
              </div>
            </div>
            <button type="button" className="btn btn-sidebar" onClick={logout}>
              <IconLogout />
              <span>Log out</span>
            </button>
            <BackupButton />
            <p className="foot-note">Data is stored locally on this computer.</p>
          </div>
        </aside>

        <main className="main">
          <Current />
        </main>
      </div>
    </ToastProvider>
  )
}

export default App;

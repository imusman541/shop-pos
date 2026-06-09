import React, { useState } from 'react'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import Orders from './pages/Orders'
import { ToastProvider } from './components/Toast'
import { IconDashboard, IconBox, IconCart } from './components/icons'
import BackupButton from './components/BackupButton'

const NAV = [
  { key: 'dashboard', label: 'Dashboard', Icon: IconDashboard, Page: Dashboard },
  { key: 'products', label: 'Products', Icon: IconBox, Page: Products },
  { key: 'orders', label: 'Orders', Icon: IconCart, Page: Orders }
]

export default function App() {
  const [active, setActive] = useState('dashboard')
  const Current = NAV.find((n) => n.key === active).Page

  return (
    <ToastProvider>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="logo">P</div>
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

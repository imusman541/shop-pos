import React, { createContext, useCallback, useContext, useState } from 'react'

const ToastCtx = createContext(() => {})

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null)

  const notify = useCallback((text) => {
    setMsg(text)
    window.clearTimeout(notify._t)
    notify._t = window.setTimeout(() => setMsg(null), 2600)
  }, [])

  return (
    <ToastCtx.Provider value={notify}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx)
}

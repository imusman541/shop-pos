import React, { useState, useRef } from 'react'
import { createPortal } from 'react-dom'

const Tooltip = ({ label, children }) => {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef(null)

  const show = () => {
    const el = ref.current
    if (!el || !label) return
    const rect = el.getBoundingClientRect()
    setPos({
      top: rect.top - 8,
      left: rect.left + rect.width / 2
    })
    setVisible(true)
  }

  const hide = () => setVisible(false)

  return (
    <>
      <span
        ref={ref}
        className="tip-trigger"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {visible && createPortal(
        <div
          className="tip-popup"
          style={{ top: pos.top, left: pos.left }}
          role="tooltip"
        >
          {label}
        </div>,
        document.body
      )}
    </>
  )
}

export default Tooltip

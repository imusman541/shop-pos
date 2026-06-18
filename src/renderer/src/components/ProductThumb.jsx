import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const PREVIEW_SIZE = 200

const ProductThumb = ({ src, name }) => {
  const anchorRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })

  if (!src) return <div className="thumb empty">—</div>

  const show = () => {
    const rect = anchorRef.current.getBoundingClientRect()
    const x = rect.right + 12
    const y = rect.top + rect.height / 2
    const maxX = window.innerWidth - PREVIEW_SIZE - 32
    const maxY = window.innerHeight - PREVIEW_SIZE / 2 - 16
    setCoords({
      x: Math.min(x, maxX),
      y: Math.min(Math.max(y, PREVIEW_SIZE / 2 + 16), maxY)
    })
    setVisible(true)
  }

  return (
    <>
      <span
        ref={anchorRef}
        className="thumb-hover"
        onMouseEnter={show}
        onMouseLeave={() => setVisible(false)}
      >
        <img className="thumb" src={src} alt={name} />
      </span>
      {visible && createPortal(
        <div className="thumb-popup" style={{ left: coords.x, top: coords.y }}>
          <img src={src} alt={name} />
        </div>,
        document.body
      )}
    </>
  )
}

export default ProductThumb;

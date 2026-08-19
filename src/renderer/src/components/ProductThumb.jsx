import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const PREVIEW_SIZE = 200

const ProductThumb = ({ src, name }) => {
  const anchorRef = useRef(null)
  const [hoverVisible, setHoverVisible] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!lightboxOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setLightboxOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxOpen])

  if (!src) return <div className="thumb empty">—</div>

  const showHover = () => {
    if (lightboxOpen) return
    const rect = anchorRef.current.getBoundingClientRect()
    const x = rect.right + 12
    const y = rect.top + rect.height / 2
    const maxX = window.innerWidth - PREVIEW_SIZE - 32
    const maxY = window.innerHeight - PREVIEW_SIZE / 2 - 16
    setCoords({
      x: Math.min(x, maxX),
      y: Math.min(Math.max(y, PREVIEW_SIZE / 2 + 16), maxY)
    })
    setHoverVisible(true)
  }

  const openLightbox = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setHoverVisible(false)
    setLightboxOpen(true)
  }

  const closeLightbox = () => setLightboxOpen(false)

  return (
    <>
      <span
        ref={anchorRef}
        className="thumb-hover"
        onMouseEnter={showHover}
        onMouseLeave={() => setHoverVisible(false)}
        onClick={openLightbox}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openLightbox(e)
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`View ${name || 'image'}`}
      >
        <img className="thumb" src={src} alt={name} />
      </span>
      {hoverVisible && !lightboxOpen && createPortal(
        <div className="thumb-popup" style={{ left: coords.x, top: coords.y }}>
          <img src={src} alt={name} />
        </div>,
        document.body
      )}
      {lightboxOpen && createPortal(
        <div
          className="image-lightbox-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeLightbox() }}
        >
          <button type="button" className="image-lightbox-close" onClick={closeLightbox} aria-label="Close">
            ×
          </button>
          <img className="image-lightbox-img" src={src} alt={name} />
        </div>,
        document.body
      )}
    </>
  )
}

export default ProductThumb

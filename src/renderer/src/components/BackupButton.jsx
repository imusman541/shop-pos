import React, { useState } from 'react'
import { useToast } from './Toast'

export default function BackupButton() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const onClick = async () => {
    setBusy(true)
    try {
      const res = await window.api.backupNow()
      toast(res.ok ? 'Backup saved' : `Backup failed: ${res.reason || 'unknown error'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className="btn btn-sm" onClick={onClick} disabled={busy}>
      {busy ? 'Backing up…' : 'Back UP Data now'}
    </button>
  )
}
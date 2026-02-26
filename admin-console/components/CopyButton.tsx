"use client"

import { useState } from 'react'
import { Copy } from 'lucide-react'

export default function CopyButton({ text, className }: { text: string, className?: string }) {
  const [copied, setCopied] = useState(false)
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <button type="button" onClick={onCopy} className={className || 'btn'} title="Copy">
      <Copy className="w-4 h-4 mr-2" /> {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

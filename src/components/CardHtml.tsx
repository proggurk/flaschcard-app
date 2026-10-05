import { useEffect, useMemo, useRef } from 'react'
import DOMPurify from 'dompurify'
import { MEDIA_CACHE } from '../lib/db.ts'

// Shows card HTML safely. Anki decks are written by strangers, so scripts,
// event handlers and other dangerous HTML are stripped before rendering.
export default function CardHtml({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const clean = useMemo(() => DOMPurify.sanitize(html), [html])

  // Images/audio: use the copy on this device if we have one (offline, or not
  // uploaded yet), otherwise the browser loads it from the server as usual.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const objectUrls: string[] = []
    let alive = true
    void (async () => {
      const cache = await caches.open(MEDIA_CACHE)
      for (const node of el.querySelectorAll<HTMLImageElement | HTMLMediaElement>('[src^="/api/media/"]')) {
        const res = await cache.match(node.getAttribute('src')!)
        if (!res || !alive) continue
        const url = URL.createObjectURL(await res.blob())
        objectUrls.push(url)
        node.src = url
      }
    })()
    return () => {
      alive = false
      objectUrls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [clean])

  return (
    <div
      ref={ref}
      className="card-html"
      // Clicking audio controls or a hint shouldn't also flip the card
      onClick={(e) => { if ((e.target as HTMLElement).closest('audio, video, details, a')) e.stopPropagation() }}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}

import { useEffect, useState, type ChangeEvent } from 'react'
import { getMeta, pendingCount, type LocalUser } from '../lib/db.ts'
import { createDeck, getDeckSummaries, type DeckSummary } from '../lib/study.ts'
import { onSynced, sync, type SyncResult } from '../lib/sync.ts'
import { logout } from '../lib/session.ts'
import { useOnline } from '../lib/useOnline.ts'
import { formatWhen } from '../lib/format.ts'
import { SAMPLE_DECK } from '../sample-deck.ts'
import type { View } from '../App.tsx'

interface Props {
  user: LocalUser
  onNavigate: (view: View) => void
  onLogout: () => void
}

interface HomeData {
  decks: DeckSummary[]
  pending: number
  lastSyncedAt: number | null
}

async function loadHome(): Promise<HomeData> {
  return {
    decks: await getDeckSummaries(),
    pending: await pendingCount(),
    lastSyncedAt: (await getMeta<number>('lastSyncedAt')) ?? null,
  }
}

export default function HomeScreen({ user, onNavigate, onLogout }: Props) {
  const online = useOnline()
  const [data, setData] = useState<HomeData>({ decks: [], pending: 0, lastSyncedAt: null })
  const [lastResult, setLastResult] = useState<SyncResult | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    const reload = () => { void loadHome().then((d) => { if (alive) setData(d) }) }
    reload()
    const unsubscribe = onSynced((result) => { setLastResult(result); reload() })
    return () => { alive = false; unsubscribe() }
  }, [reloadKey])

  async function addSampleDeck() {
    await createDeck(SAMPLE_DECK.name, SAMPLE_DECK.cards)
    setReloadKey((k) => k + 1)
  }

  const [importStatus, setImportStatus] = useState<string | null>(null)

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (!file) return
    try {
      // Loaded on demand: the SQLite engine is ~1 MB and only needed here
      const { importApkg } = await import('../lib/anki/import.ts')
      const r = await importApkg(file, setImportStatus)
      const lines = r.decks.map((d) => `${d.name}: ${d.added} new cards${d.updated ? `, ${d.updated} updated` : ''}`)
      if (r.media) lines.push(`${r.media} images/audio files`)
      if (r.skippedCards) lines.push(`${r.skippedCards} empty cards skipped`)
      if (r.missingMedia.length) lines.push(`Missing media files: ${r.missingMedia.slice(0, 5).join(', ')}${r.missingMedia.length > 5 ? '…' : ''}`)
      setImportStatus(`✔ Imported!\n${lines.join('\n')}`)
    } catch (err) {
      console.error(err)
      setImportStatus(`✖ Import failed: ${(err as Error).message}`)
    }
    setReloadKey((k) => k + 1)
  }

  const { decks, pending, lastSyncedAt } = data

  async function handleLogout() {
    if (await logout()) onLogout()
  }

  return (
    <div>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{user.username ? `@${user.username}` : user.displayName ?? user.email}</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onNavigate({ screen: 'social' })}>Friends & leaderboard</button>
          <button onClick={handleLogout}>Log out</button>
        </span>
      </header>

      <p style={{ fontSize: 13, color: '#666' }}>
        {online ? '🟢 Online' : '🔴 Offline'}
        {' · '}{pending === 0 ? 'All synced' : `${pending} waiting to sync`}
        {lastSyncedAt && ` · last synced ${new Date(lastSyncedAt).toLocaleTimeString()}`}
        {lastResult === 'error' && ' · ⚠️ sync error'}
        {' '}<button onClick={() => void sync()} disabled={!online}>Sync now</button>
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2>Decks</h2>
        {decks.length > 0 && (
          <span style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onNavigate({ screen: 'exam', deckId: null, title: 'All decks' })}>Exam (all)</button>
            <button onClick={() => onNavigate({ screen: 'stats', deckId: null, title: 'All decks' })}>All stats</button>
          </span>
        )}
      </div>
      {decks.length === 0 && <p>No decks yet.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {decks.map((s) => {
          const toStudy = s.new + s.learning + s.due
          return (
            <li key={s.deck.id} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <strong>{s.deck.name}</strong>
              <div style={{ fontSize: 13, color: '#666' }}>
                {s.new} new · {s.learning} learning · {s.due} due
              </div>
              <div style={{ fontSize: 12, color: '#888' }}>
                {s.total} cards, {s.unseen} not studied yet
                {s.newLimitReached && ' · daily new-card limit reached'}
                {toStudy === 0 && s.nextDueAt && ` · next card ${formatWhen(s.nextDueAt)}`}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => onNavigate({ screen: 'study', deckId: s.deck.id })} disabled={toStudy === 0}>
                  Study
                </button>
                <button onClick={() => onNavigate({ screen: 'exam', deckId: s.deck.id, title: s.deck.name })}>Exam</button>
                <button onClick={() => onNavigate({ screen: 'stats', deckId: s.deck.id, title: s.deck.name })}>Stats</button>
              </div>
            </li>
          )
        })}
      </ul>

      <div style={{ border: '2px dashed #ccc', borderRadius: 8, padding: 12, margin: '16px 0' }}>
        <p style={{ fontWeight: 'bold', marginBottom: 8 }}>Import an Anki deck (.apkg)</p>
        <input type="file" accept=".apkg,.colpkg" onChange={(e) => void handleImport(e)} />
        {importStatus && <p style={{ whiteSpace: 'pre-line', fontSize: 13, marginTop: 8 }}>{importStatus}</p>}
      </div>

      <button onClick={addSampleDeck}>+ Add sample deck</button>
    </div>
  )
}

import { useState, type ChangeEvent } from 'react'
import { createDeck } from '../lib/study.ts'
import { SAMPLE_DECK } from '../sample-deck.ts'
import { useNav } from '../ui/nav.ts'
import Icon from '../ui/icons.tsx'
import { Group, Row, RowIcon, Section, Sheet } from '../ui/controls.tsx'

type Status =
  | { kind: 'idle' }
  | { kind: 'working', text: string }
  | { kind: 'done', lines: string[] }
  | { kind: 'error', text: string }

export default function AddSheet({ leaving, onClose }: { leaving: boolean, onClose: () => void }) {
  const nav = useNav()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const working = status.kind === 'working'

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (!file) return
    setStatus({ kind: 'working', text: 'Reading the deck…' })
    try {
      // Loaded on demand: the SQLite engine is ~1 MB and only needed here
      const { importApkg } = await import('../lib/anki/import.ts')
      const r = await importApkg(file, (text) => setStatus({ kind: 'working', text }))
      const lines = r.decks.map((d) => `${d.name}: ${d.added} new ${d.added === 1 ? 'card' : 'cards'}${d.updated ? `, ${d.updated} updated` : ''}`)
      if (r.media) lines.push(`${r.media} images and audio files`)
      if (r.skippedCards) lines.push(`${r.skippedCards} empty cards skipped`)
      if (r.missingMedia.length) lines.push(`Missing media: ${r.missingMedia.slice(0, 5).join(', ')}${r.missingMedia.length > 5 ? '…' : ''}`)
      setStatus({ kind: 'done', lines })
    } catch (err) {
      console.error(err)
      setStatus({ kind: 'error', text: `Import failed: ${(err as Error).message}` })
    }
    nav.refresh()
  }

  async function addSample() {
    await createDeck(SAMPLE_DECK.name, SAMPLE_DECK.cards)
    nav.refresh()
    onClose()
  }

  return (
    <Sheet title="Add deck" leaving={leaving} onClose={working ? () => {} : onClose}
      left={status.kind !== 'done' && <button className="nav-btn" onClick={onClose} disabled={working}>Cancel</button>}>

      {status.kind === 'done' ? (
        <div className="empty" style={{ paddingTop: 24 }}>
          <div className="done-badge" style={{ width: 72, height: 72, marginBottom: 4 }}><Icon name="check" size={36} weight={3} /></div>
          <p className="empty-title">Imported!</p>
          {status.lines.map((line) => <p key={line} className="empty-text">{line}</p>)}
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      ) : (
        <>
          <Section footer={working ? status.text : status.kind === 'error' ? status.text : 'Imported decks are saved on this phone first, so this works offline too.'}
            error={status.kind === 'error'}>
            <Group>
              <label className="row with-icon" style={{ cursor: working ? 'default' : 'pointer', opacity: working ? 0.5 : 1 }}>
                <RowIcon color="#34c759" icon="fileImport" />
                <div className="row-main">
                  <div className="row-title">Import from Anki</div>
                  <div className="row-sub">An .apkg file, with images and audio</div>
                </div>
                <span className="row-chevron"><Icon name="chevronRight" size={18} weight={2.4} /></span>
                <input type="file" accept=".apkg,.colpkg" className="sr-only" disabled={working} onChange={(e) => void handleImport(e)} />
              </label>
              <Row inset="icon" icon={<RowIcon color="#ff9f0a" icon="sparkles" />}
                title="Sample deck" sub={`${SAMPLE_DECK.cards.length} cards: world capitals`} chevron
                disabled={working} onClick={() => void addSample()} />
            </Group>
          </Section>
        </>
      )}
    </Sheet>
  )
}

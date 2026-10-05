// Turns a parsed .apkg into decks in the local database.
// Importing the same deck again updates the existing cards (keeping your progress)
// instead of creating duplicates.
import { getDB, MEDIA_CACHE } from '../db.ts'
import { saveDeck } from '../study.ts'
import { parseApkg } from './apkg.ts'

export interface ImportResult {
  decks: { name: string, added: number, updated: number }[]
  media: number
  skippedCards: number
  missingMedia: string[]
}

export async function importApkg(file: File, onProgress: (msg: string) => void): Promise<ImportResult> {
  const parsed = await parseApkg(file, onProgress)
  const db = await getDB()

  // Media: cache locally right away (works offline), queue for upload to the server
  onProgress('Saving media…')
  const cache = await caches.open(MEDIA_CACHE)
  for (const m of parsed.media) {
    await cache.put(m.url, new Response(m.blob, { headers: { 'Content-Type': m.blob.type } }))
    await db.put('outboxMedia', { name: m.name, blob: m.blob })
  }

  onProgress('Saving decks…')
  const existingDecks = [...await db.getAll('decks'), ...await db.getAll('outboxDecks')]
  const result: ImportResult = { decks: [], media: parsed.media.length, skippedCards: parsed.skippedCards, missingMedia: parsed.missingMedia }

  for (const deck of parsed.decks) {
    // Same deck name as before => update that deck
    const deckId = existingDecks.find((d) => d.name === deck.name)?.id ?? crypto.randomUUID()
    const existingCards = new Map(
      (await db.getAllFromIndex('cards', 'byDeck', deckId))
        .filter((c) => c.ankiNoteId)
        .map((c) => [c.ankiNoteId!, c.id]),
    )

    let updated = 0
    const cards = deck.cards.map((c, i) => {
      const existingId = existingCards.get(c.ankiId)
      if (existingId) updated++
      // Parsed cards are already in the Anki deck's order
      return { id: existingId ?? crypto.randomUUID(), front: c.front, back: c.back, ankiNoteId: c.ankiId, position: i }
    })

    await saveDeck({ id: deckId, name: deck.name, description: null, cards })
    result.decks.push({ name: deck.name, added: cards.length - updated, updated })
  }

  return result
}

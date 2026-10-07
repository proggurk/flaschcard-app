// Reversed cards: once you know a card well (it's mature), it's asked the other
// way round. Spanish -> English becomes English -> Spanish, which is harder:
// recognizing a word is easier than producing it. If you don't know it reversed,
// it drops back to learning and is asked the normal way until it's mature again.
import type { SyncCard } from '../../shared/sync-types.ts'
import type { CardState } from '../../shared/srs.ts'
import { MATURE_DAYS } from './stats.ts'

export const REVERSE_AFTER_DAYS = MATURE_DAYS

// Notes that already have more than one card in the deck (e.g. Anki's
// "Basic (and reversed card)"): they come with their own reverse card.
export function notesWithSiblings(cards: SyncCard[]): Set<string> {
  const seen = new Set<string>()
  const twice = new Set<string>()
  for (const c of cards) {
    if (!c.ankiNoteId) continue
    const note = noteOf(c.ankiNoteId)
    if (seen.has(note)) twice.add(note)
    else seen.add(note)
  }
  return twice
}

// Whether asking this card the other way round makes sense
export function canReverse(card: SyncCard, siblings: Set<string>): boolean {
  if (/class=["']?cloze\b/.test(card.front)) return false // fill-in-the-blank has no reverse
  if (card.ankiNoteId && siblings.has(noteOf(card.ankiNoteId))) return false // has its own reverse card
  return hasContent(card.back) // the answer becomes the question, so it can't be empty
}

export function isReversed(card: SyncCard, state: CardState, siblings: Set<string>): boolean {
  return state.intervalDays >= REVERSE_AFTER_DAYS && canReverse(card, siblings)
}

// ankiNoteId is "<note guid>:<template number>"; the guid itself may contain ':'
function noteOf(ankiNoteId: string) {
  const i = ankiNoteId.lastIndexOf(':')
  return i < 0 ? ankiNoteId : ankiNoteId.slice(0, i)
}

function hasContent(html: string) {
  return /<(img|audio|video)\b|\[sound:/i.test(html) || html.replace(/<[^>]*>|&nbsp;/g, '').trim() !== ''
}

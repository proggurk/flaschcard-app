// Stable colors for decks and people, picked from their id so they never
// change between visits or devices (and need no extra field in the database).
const DECK_COLORS = ['#0a84ff', '#bf5af2', '#ff9f0a', '#ff375f', '#5e5ce6', '#30b0c7', '#34c759', '#ac8e68']
const AVATAR_COLORS = ['#5e5ce6', '#ff9f0a', '#30b0c7', '#ff375f', '#bf5af2', '#0a84ff', '#34c759']

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export const deckColor = (deckId: string) => DECK_COLORS[hash(deckId) % DECK_COLORS.length]
export const avatarColor = (userId: string) => AVATAR_COLORS[hash(userId) % AVATAR_COLORS.length]

// First letter or digit of a name, for icon squares and avatars
export function initial(name: string): string {
  const match = name.match(/[\p{L}\p{N}]/u)
  return match ? match[0].toUpperCase() : '?'
}

// Run with: npm test
// Builds small fake .apkg files in both Anki formats and checks the parser.
import { describe, test, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { zstdCompressSync } from 'node:zlib'
import JSZip from 'jszip'
import initSqlJs from 'sql.js'

// In the browser Vite gives us a URL for the .wasm; in Node, point at the file
const require = createRequire(import.meta.url)
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: wasmPath }))

const { parseApkg } = await import('./apkg.ts')

const SQL = await initSqlJs({ locateFile: () => wasmPath })

const CAT_JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]) // fake image bytes
const HEJ_MP3 = new Uint8Array([0x49, 0x44, 0x33, 9, 8, 7]) // fake audio bytes
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

const BASIC_FRONT = '{{Front}}{{#Extra}}<div class="extra">{{Extra}}</div>{{/Extra}}'
const BASIC_BACK = '{{FrontSide}}<hr id=answer>{{Back}}'
const REVERSE_FRONT = '{{Back}}'
const REVERSE_BACK = '{{FrontSide}}<br>{{Front}}' // no <hr id=answer> marker on purpose
const CLOZE_TMPL = '{{cloze:Text}}'
const CLOZE_BACK = '{{cloze:Text}}<br>{{Extra}}'

const NOTES = [
  // id, guid, model, fields, deck
  { id: 1, guid: 'g-cat', mid: 100, flds: ['Katt <img src="cat.jpg">', 'Cat [sound:hej.mp3]', ''], did: 10 },
  { id: 2, guid: 'g-dog', mid: 100, flds: ['Hund', 'Dog', 'ett djur'], did: 11 },
  { id: 3, guid: 'g-cloze', mid: 200, flds: ['{{c1::Stockholm}} är huvudstad i {{c2::Sverige::land}}', 'extra info'], did: 11 },
]
// Basic model makes 2 cards per note (forward + reverse), cloze one per cloze number.
// `due` is the new-card position: in "Djur::Mer" the cloze note comes before the dog
// note even though the dog note was created first.
const CARDS = [
  { nid: 1, ord: 0, due: 0 }, { nid: 1, ord: 1, due: 1 },
  { nid: 2, ord: 0, due: 7 }, { nid: 2, ord: 1, due: 8 },
  { nid: 3, ord: 0, due: 3 }, { nid: 3, ord: 1, due: 4 },
]

function createNotesAndCards(db: InstanceType<typeof SQL.Database>) {
  db.run('create table notes (id integer primary key, guid text, mid integer, flds text, tags text)')
  db.run('create table cards (id integer primary key, nid integer, did integer, ord integer, odid integer, type integer, due integer)')
  for (const n of NOTES) db.run('insert into notes values (?, ?, ?, ?, ?)', [n.id, n.guid, n.mid, n.flds.join('\x1f'), ' vocab '])
  CARDS.forEach((c, i) => {
    const did = NOTES.find((n) => n.id === c.nid)!.did
    db.run('insert into cards values (?, ?, ?, ?, 0, 0, ?)', [i + 1, c.nid, did, c.ord, c.due])
  })
}

// ---- Old format: collection.anki2 with JSON in the col table ----
async function buildLegacyApkg(): Promise<Blob> {
  const db = new SQL.Database()
  db.run('create table col (models text, decks text)')
  const models = {
    100: {
      name: 'Basic (and reversed)', type: 0,
      flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }, { name: 'Extra', ord: 2 }],
      tmpls: [
        { name: 'Card 1', ord: 0, qfmt: BASIC_FRONT, afmt: BASIC_BACK },
        { name: 'Card 2', ord: 1, qfmt: REVERSE_FRONT, afmt: REVERSE_BACK },
      ],
    },
    200: {
      name: 'Cloze', type: 1,
      flds: [{ name: 'Text', ord: 0 }, { name: 'Extra', ord: 1 }],
      tmpls: [{ name: 'Cloze', ord: 0, qfmt: CLOZE_TMPL, afmt: CLOZE_BACK }],
    },
  }
  const decks = { 10: { name: 'Djur' }, 11: { name: 'Djur::Mer' } }
  db.run('insert into col values (?, ?)', [JSON.stringify(models), JSON.stringify(decks)])
  createNotesAndCards(db)

  const zip = new JSZip()
  zip.file('collection.anki2', db.export())
  zip.file('media', JSON.stringify({ 0: 'cat.jpg', 1: 'hej.mp3' }))
  zip.file('0', CAT_JPG)
  zip.file('1', HEJ_MP3)
  db.close()
  return zip.generateAsync({ type: 'blob' })
}

// ---- New format: zstd-compressed collection.anki21b, protobuf settings ----

// Tiny protobuf writer for the test fixtures
function varint(n: number): number[] {
  const out: number[] = []
  while (n >= 128) { out.push((n % 128) | 128); n = Math.floor(n / 128) }
  out.push(n)
  return out
}
const pbVarint = (field: number, v: number) => [...varint(field * 8), ...varint(v)]
const pbBytes = (field: number, b: Uint8Array | number[]) => [...varint(field * 8 + 2), ...varint(b.length), ...b]
const pbString = (field: number, s: string) => pbBytes(field, new TextEncoder().encode(s))
const zstd = (b: Uint8Array) => new Uint8Array(zstdCompressSync(b))

async function buildNewApkg(): Promise<Blob> {
  const db = new SQL.Database()
  db.run('create table notetypes (id integer primary key, name text, config blob)')
  db.run('create table fields (ntid integer, ord integer, name text)')
  db.run('create table templates (ntid integer, ord integer, name text, config blob)')
  db.run('create table decks (id integer primary key, name text)')

  db.run('insert into notetypes values (?, ?, ?)', [100, 'Basic (and reversed)', new Uint8Array(pbVarint(1, 0))])
  db.run('insert into notetypes values (?, ?, ?)', [200, 'Cloze', new Uint8Array(pbVarint(1, 1))])
  for (const [ord, name] of ['Front', 'Back', 'Extra'].entries()) db.run('insert into fields values (100, ?, ?)', [ord, name])
  for (const [ord, name] of ['Text', 'Extra'].entries()) db.run('insert into fields values (200, ?, ?)', [ord, name])
  const tmpl = (q: string, a: string) => new Uint8Array([...pbString(1, q), ...pbString(2, a)])
  db.run('insert into templates values (100, 0, ?, ?)', ['Card 1', tmpl(BASIC_FRONT, BASIC_BACK)])
  db.run('insert into templates values (100, 1, ?, ?)', ['Card 2', tmpl(REVERSE_FRONT, REVERSE_BACK)])
  db.run('insert into templates values (200, 0, ?, ?)', ['Cloze', tmpl(CLOZE_TMPL, CLOZE_BACK)])
  db.run('insert into decks values (10, ?)', ['Djur'])
  db.run('insert into decks values (11, ?)', ['Djur\x1fMer'])
  createNotesAndCards(db)

  // MediaEntries { repeated MediaEntry entries = 1 }, MediaEntry { name = 1, size = 2 }
  const entry = (name: string, size: number) => pbBytes(1, [...pbString(1, name), ...pbVarint(2, size)])
  const mediaIndex = new Uint8Array([...entry('cat.jpg', CAT_JPG.length), ...entry('hej.mp3', HEJ_MP3.length)])

  const zip = new JSZip()
  zip.file('collection.anki2', new Uint8Array([1, 2, 3])) // stub "please update Anki" collection
  zip.file('collection.anki21b', zstd(db.export()))
  zip.file('media', zstd(mediaIndex))
  zip.file('0', zstd(CAT_JPG))
  zip.file('1', zstd(HEJ_MP3))
  db.close()
  return zip.generateAsync({ type: 'blob' })
}

describe.each([
  ['old format (collection.anki2)', buildLegacyApkg],
  ['new format (collection.anki21b)', buildNewApkg],
])('%s', (_, build) => {
  test('reads decks and cards', async () => {
    const result = await parseApkg(await build())
    expect(result.decks.map((d) => d.name).sort()).toEqual(['Djur', 'Djur::Mer'])
    expect(result.decks.flatMap((d) => d.cards)).toHaveLength(6)
    expect(result.skippedCards).toBe(0)
    expect(result.missingMedia).toEqual([])
  })

  test('renders basic and reversed cards, with conditional sections', async () => {
    const cards = (await parseApkg(await build())).decks.flatMap((d) => d.cards)
    const dogForward = cards.find((c) => c.ankiId === 'g-dog:0')!
    expect(dogForward.front).toBe('Hund<div class="extra">ett djur</div>')
    // The back shows only the answer: the question is on the other side of the card
    expect(dogForward.back).toBe('Dog')

    const dogReverse = cards.find((c) => c.ankiId === 'g-dog:1')!
    expect(dogReverse.front).toBe('Dog')
    // No <hr id=answer> in this template: {{FrontSide}} is simply left out
    expect(dogReverse.back).toBe('<br>Hund')

    // Empty "Extra" field: the {{#Extra}} section disappears
    const catForward = cards.find((c) => c.ankiId === 'g-cat:0')!
    expect(catForward.front).not.toContain('extra')
  })

  test('keeps the deck\'s new-card order', async () => {
    const deck = (await parseApkg(await build())).decks.find((d) => d.name === 'Djur::Mer')!
    expect(deck.cards.map((c) => c.ankiId)).toEqual(['g-cloze:0', 'g-cloze:1', 'g-dog:0', 'g-dog:1'])
  })

  test('renders cloze deletions, one card per cloze', async () => {
    const cards = (await parseApkg(await build())).decks.flatMap((d) => d.cards)
    const c1 = cards.find((c) => c.ankiId === 'g-cloze:0')!
    expect(c1.front).toBe('<span class="cloze">[...]</span> är huvudstad i Sverige')
    expect(c1.back).toBe('<span class="cloze">Stockholm</span> är huvudstad i Sverige<br>extra info')
    const c2 = cards.find((c) => c.ankiId === 'g-cloze:1')!
    expect(c2.front).toBe('Stockholm är huvudstad i <span class="cloze">[land]</span>') // hint shown
  })

  test('extracts media and points cards at hashed URLs', async () => {
    const result = await parseApkg(await build())
    const catUrl = `/api/media/${sha(CAT_JPG)}.jpg`
    const hejUrl = `/api/media/${sha(HEJ_MP3)}.mp3`
    expect(result.media.map((m) => m.url).sort()).toEqual([catUrl, hejUrl].sort())

    const cat = result.media.find((m) => m.url === catUrl)!
    expect(cat.blob.type).toBe('image/jpeg')
    expect(new Uint8Array(await cat.blob.arrayBuffer())).toEqual(CAT_JPG) // decompressed correctly

    const card = result.decks.flatMap((d) => d.cards).find((c) => c.ankiId === 'g-cat:0')!
    expect(card.front).toBe(`Katt <img src="${catUrl}">`)
    expect(card.back).toContain(`<audio controls src="${hejUrl}"></audio>`)
  })
})

test('a file that is not an Anki deck gives a clear error', async () => {
  const zip = new JSZip()
  zip.file('hello.txt', 'hi')
  await expect(parseApkg(await zip.generateAsync({ type: 'blob' }))).rejects.toThrow(/Anki/)
})

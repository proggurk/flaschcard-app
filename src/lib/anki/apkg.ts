// Reads an Anki .apkg / .colpkg file entirely in the browser.
//
// An .apkg is a zip containing:
//   collection.anki21b  newest format: zstd-compressed SQLite (Anki 2.1.50+)
//   collection.anki21   older SQLite
//   collection.anki2    oldest SQLite (in new exports just a stub that says "update Anki")
//   media               index of media files: JSON (old) or zstd+protobuf (new)
//   0, 1, 2, ...        the media files themselves (zstd-compressed in the new format)
import JSZip from 'jszip'
import initSqlJs, { type Database } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { decompress } from 'fzstd'
import { readProto, protoNumber, protoString } from './protobuf.ts'
import { renderTemplate, isEmptyField, stripHtml, type TemplateContext } from './template.ts'

export interface ParsedCard {
  ankiId: string // "<note guid>:<template ord>" - stable across exports
  front: string
  back: string
}

export interface ParsedDeck {
  name: string
  cards: ParsedCard[]
}

export interface ParsedMedia {
  url: string // "/api/media/<sha256>.<ext>": how cards reference it
  name: string // "<sha256>.<ext>"
  blob: Blob
}

export interface ParsedApkg {
  decks: ParsedDeck[]
  media: ParsedMedia[]
  skippedCards: number
  missingMedia: string[]
}

interface NoteType {
  name: string
  isCloze: boolean
  fieldNames: string[]
  templates: { ord: number, name: string, qfmt: string, afmt: string }[]
}

const MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav',
  m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/ogg', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm',
}

// Placeholder written into card HTML during rendering, swapped for the real
// URL once we know the file's hash
const MEDIA_TOKEN = 'anki-media:'

export async function parseApkg(file: Blob, onProgress: (msg: string) => void = () => {}): Promise<ParsedApkg> {
  onProgress('Unzipping…')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  const collectionBytes = await readCollection(zip)
  onProgress('Reading the database…')
  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl })
  const db = new SQL.Database(collectionBytes)

  try {
    const isNewSchema = query(db, "select name from sqlite_master where type = 'table' and name = 'notetypes'").length > 0
    const noteTypes = isNewSchema ? readNoteTypesNew(db) : readNoteTypesLegacy(db)
    const deckNames = isNewSchema ? readDecksNew(db) : readDecksLegacy(db)
    const mediaIndex = await readMediaIndex(zip) // original filename -> name inside zip

    onProgress('Creating cards…')
    const usedMedia = new Set<string>()
    const mediaRef = (filename: string): string | undefined => {
      const found = resolveMediaName(filename, mediaIndex)
      if (!found) return undefined
      usedMedia.add(found)
      return MEDIA_TOKEN + encodeURIComponent(found)
    }

    // For new cards (type 0) Anki stores their position in the deck in `due`,
    // which is how frequency-ordered decks keep "most common words first".
    const rows = query(db, `
      select c.ord, case when c.odid != 0 then c.odid else c.did end as did,
             n.guid, n.mid, n.flds, n.tags
      from cards c join notes n on n.id = c.nid
      order by did, c.type != 0, case when c.type = 0 then c.due end, n.id, c.ord`)

    const decks = new Map<string, ParsedCard[]>()
    let skippedCards = 0
    const missing = new Set<string>()

    for (const [ord, did, guid, mid, flds, tags] of rows as [number, number, string, number, string, string][]) {
      const noteType = noteTypes.get(String(mid))
      const template = noteType?.isCloze ? noteType.templates[0] : noteType?.templates.find((t) => t.ord === ord)
      if (!noteType || !template) { skippedCards++; continue }

      const values = flds.split('\x1f')
      const fields: Record<string, string> = {}
      noteType.fieldNames.forEach((name, i) => { fields[name] = values[i] ?? '' })

      const deck = deckNames.get(String(did)) ?? 'Anki'
      const ctx = {
        fields,
        clozeOrd: noteType.isCloze ? ord + 1 : null,
        frontSide: '',
        tags: tags.trim(),
        deck,
        cardName: template.name,
        noteType: noteType.name,
      }
      const front = renderTemplate(template.qfmt, ctx, 'q')
      if (!hasContent(front)) { skippedCards++; continue }
      const back = answerOnly(template.afmt, ctx, front)

      const card = {
        ankiId: `${guid}:${ord}`,
        front: rewriteMedia(front, mediaRef, missing),
        back: rewriteMedia(back, mediaRef, missing),
      }
      const list = decks.get(deck)
      if (list) list.push(card)
      else decks.set(deck, [card])
    }

    // Hash the media files that are actually used, then fill in their URLs
    onProgress(`Reading ${usedMedia.size} media files…`)
    const urls = new Map<string, string>()
    const media: ParsedMedia[] = []
    for (const filename of usedMedia) {
      const ext = filename.split('.').pop()!.toLowerCase()
      const zipEntry = zip.file(mediaIndex.get(filename)!)
      if (!zipEntry || !MEDIA_TYPES[ext]) { missing.add(filename); continue }
      let bytes = await zipEntry.async('uint8array')
      if (isZstd(bytes)) bytes = decompress(bytes)
      const hash = await sha256Hex(bytes)
      const name = `${hash}.${ext}`
      const url = `/api/media/${name}`
      urls.set(filename, url)
      media.push({ url, name, blob: new Blob([bytes as BlobPart], { type: MEDIA_TYPES[ext] }) })
    }

    const fillUrls = (html: string) => html.replace(
      new RegExp(MEDIA_TOKEN + '([^"\'\\s<>]+)', 'g'),
      (_, enc: string) => urls.get(decodeURIComponent(enc)) ?? '',
    )

    return {
      decks: [...decks].map(([name, cards]) => ({
        name,
        cards: cards.map((c) => ({ ...c, front: fillUrls(c.front), back: fillUrls(c.back) })),
      })),
      media,
      skippedCards,
      missingMedia: [...missing],
    }
  } finally {
    db.close()
  }
}

function hasContent(html: string) {
  return !isEmptyField(stripHtml(html)) || /<(img|audio|video)\b|\[sound:/i.test(html)
}

// Anki answer templates usually repeat the question: "{{FrontSide}}<hr id=answer>{{Back}}".
// That makes sense in Anki, where the card doesn't flip. Our card has the question on
// its other side, so the back shows only the answer part.
const ANSWER_MARKER = /<hr\s+id\s*=\s*["']?answer["']?[^>]*>/i

function answerOnly(afmt: string, ctx: TemplateContext, front: string): string {
  const full = renderTemplate(afmt, { ...ctx, frontSide: front }, 'a')
  const marker = ANSWER_MARKER.exec(full)
  // Everything after the <hr id=answer> line is the answer
  let answer = marker ? full.slice(marker.index + marker[0].length) : renderTemplate(afmt, ctx, 'a')
  answer = answer.trim()
  // If nothing is left (unusual template), fall back to Anki's full answer
  return hasContent(answer) ? answer : full
}

async function readCollection(zip: JSZip): Promise<Uint8Array> {
  const newest = zip.file('collection.anki21b')
  if (newest) return decompress(await newest.async('uint8array'))
  const file = zip.file('collection.anki21') ?? zip.file('collection.anki2')
  if (!file) throw new Error('No Anki collection found in this file. Is it really an .apkg?')
  return file.async('uint8array')
}

function query(db: Database, sql: string): unknown[][] {
  return db.exec(sql)[0]?.values ?? []
}

// ---- Note types (models) and decks: old schema keeps them as JSON in `col` ----

function readNoteTypesLegacy(db: Database): Map<string, NoteType> {
  const [[json]] = query(db, 'select models from col') as [[string]]
  const models = JSON.parse(json) as Record<string, {
    name: string, type: number,
    flds: { name: string, ord: number }[],
    tmpls: { name: string, ord: number, qfmt: string, afmt: string }[],
  }>
  const result = new Map<string, NoteType>()
  for (const [id, m] of Object.entries(models)) {
    result.set(id, {
      name: m.name,
      isCloze: m.type === 1,
      fieldNames: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
      templates: m.tmpls.map((t) => ({ ord: t.ord, name: t.name, qfmt: t.qfmt, afmt: t.afmt })),
    })
  }
  return result
}

function readDecksLegacy(db: Database): Map<string, string> {
  const [[json]] = query(db, 'select decks from col') as [[string]]
  const decks = JSON.parse(json) as Record<string, { name: string }>
  return new Map(Object.entries(decks).map(([id, d]) => [id, d.name]))
}

// ---- New schema: separate tables, settings stored as protobuf blobs ----

function readNoteTypesNew(db: Database): Map<string, NoteType> {
  const result = new Map<string, NoteType>()
  for (const [id, name, config] of query(db, 'select id, name, config from notetypes') as [number, string, Uint8Array][]) {
    // NotetypeConfig: field 1 = kind (0 normal, 1 cloze)
    result.set(String(id), { name, isCloze: protoNumber(readProto(config), 1) === 1, fieldNames: [], templates: [] })
  }
  for (const [ntid, , name] of query(db, 'select ntid, ord, name from fields order by ntid, ord') as [number, number, string][]) {
    result.get(String(ntid))?.fieldNames.push(name)
  }
  for (const [ntid, ord, name, config] of query(db, 'select ntid, ord, name, config from templates order by ntid, ord') as [number, number, string, Uint8Array][]) {
    // CardTemplate config: field 1 = question format, field 2 = answer format
    const cfg = readProto(config)
    result.get(String(ntid))?.templates.push({ ord, name, qfmt: protoString(cfg, 1) ?? '', afmt: protoString(cfg, 2) ?? '' })
  }
  return result
}

function readDecksNew(db: Database): Map<string, string> {
  // Nested deck names are stored with \x1f as separator; Anki shows them as "Parent::Child"
  return new Map((query(db, 'select id, name from decks') as [number, string][])
    .map(([id, name]) => [String(id), name.replaceAll('\x1f', '::')]))
}

// ---- Media ----

async function readMediaIndex(zip: JSZip): Promise<Map<string, string>> {
  const index = new Map<string, string>()
  const file = zip.file('media')
  if (!file) return index
  let bytes = await file.async('uint8array')
  if (isZstd(bytes)) bytes = decompress(bytes)

  try {
    // Old format: {"0": "picture.jpg", "1": "sound.mp3"}
    const json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>
    for (const [zipName, filename] of Object.entries(json)) index.set(filename, zipName)
  } catch {
    // New format: MediaEntries { repeated MediaEntry entries = 1 }
    // MediaEntry { string name = 1; ...; optional uint32 legacy_zip_filename = 255 }
    const entries = readProto(bytes).get(1) ?? []
    entries.forEach((raw, i) => {
      if (!(raw instanceof Uint8Array)) return
      const entry = readProto(raw)
      const filename = protoString(entry, 1)
      if (filename) index.set(filename, String(protoNumber(entry, 255) ?? i))
    })
  }
  return index
}

function resolveMediaName(raw: string, index: Map<string, string>): string | undefined {
  const candidates = [raw, safeDecode(raw), raw.replace(/&amp;/g, '&')]
  return candidates.find((c) => index.has(c))
}

function safeDecode(s: string) {
  try { return decodeURIComponent(s) } catch { return s }
}

// Point <img src="x.jpg"> and [sound:x.mp3] at our media URLs
function rewriteMedia(html: string, ref: (filename: string) => string | undefined, missing: Set<string>): string {
  const swap = (filename: string) => {
    if (/^(https?:|data:|\/)/i.test(filename)) return undefined // external or already absolute
    const r = ref(filename)
    if (!r) missing.add(filename)
    return r
  }
  return html
    .replace(/(<(?:img|audio|video|source)\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi,
      (m, pre: string, q: string, src: string) => { const r = swap(src); return r ? `${pre}${q}${r}${q}` : m })
    .replace(/(<(?:img|audio|video|source)\b[^>]*?\bsrc\s*=\s*)([^\s"'>]+)/gi,
      (m, pre: string, src: string) => { const r = swap(src); return r ? `${pre}"${r}"` : m })
    .replace(/\[sound:(.+?)\]/g,
      (_, f: string) => { const r = swap(f); return r ? `<audio controls src="${r}"></audio>` : '' })
}

function isZstd(bytes: Uint8Array) {
  return bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

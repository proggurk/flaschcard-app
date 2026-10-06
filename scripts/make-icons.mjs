// Draws the app icon and writes it as PNGs (iOS needs PNG for the home screen
// icon; it ignores SVG). No dependencies: shapes are drawn with signed distance
// functions and 4x4 supersampling, then encoded as PNG by hand.
// Run with `node scripts/make-icons.mjs` after changing the design.
// Keep public/favicon.svg in sync with the shapes below.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BG = [0x16, 0x16, 0x18]
const BACK_CARD = [0x34, 0x34, 0x3a]
const FRONT_CARD = [0x3f, 0xd6, 0x8c] // the app's accent green
const INK = [0x0b, 0x3d, 0x24]        // lines on the front card

// Shapes on a 0..1 canvas: rounded rectangles, rotated around their center
const shapes = [
  { color: BACK_CARD, cx: 0.44, cy: 0.47, w: 0.42, h: 0.54, r: 0.06, deg: -12 },
  { color: FRONT_CARD, cx: 0.56, cy: 0.53, w: 0.42, h: 0.54, r: 0.06, deg: 6 },
  { color: INK, cx: 0.56, cy: 0.47, w: 0.24, h: 0.045, r: 0.0225, deg: 6, origin: [0.56, 0.53] },
  { color: INK, cx: 0.56, cy: 0.565, w: 0.16, h: 0.045, r: 0.0225, deg: 6, origin: [0.56, 0.53] },
]

function roundedRectDistance(px, py, s) {
  // Rotate the point into the shape's frame (around its card's center)
  const [ox, oy] = s.origin ?? [s.cx, s.cy]
  const a = (-s.deg * Math.PI) / 180
  const dx = px - ox, dy = py - oy
  const x = ox + dx * Math.cos(a) - dy * Math.sin(a) - s.cx
  const y = oy + dx * Math.sin(a) + dy * Math.cos(a) - s.cy
  const qx = Math.abs(x) - (s.w / 2 - s.r)
  const qy = Math.abs(y) - (s.h / 2 - s.r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - s.r
}

function render(size) {
  const SS = 4 // samples per axis
  const pixels = Buffer.alloc(size * size * 3)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0]
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size
          const y = (py + (sy + 0.5) / SS) / size
          let color = BG
          for (const s of shapes) if (roundedRectDistance(x, y, s) <= 0) color = s.color
          for (let i = 0; i < 3; i++) sum[i] += color[i]
        }
      }
      for (let i = 0; i < 3; i++) pixels[(py * size + px) * 3 + i] = Math.round(sum[i] / (SS * SS))
    }
  }
  return pixels
}

// ---- Minimal PNG encoder (8-bit RGB, no filtering) ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size, rgb) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8  // bit depth
  header[9] = 2  // color type: RGB
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// The background fills the whole square and the cards sit inside the central
// 80%, so the same image works as an iOS icon and as an Android "maskable" icon.
for (const size of [180, 192, 512]) {
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png(size, render(size)))
  console.log(`public/icon-${size}.png`)
}

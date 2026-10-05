// Minimal protobuf reader: just enough to read the few binary blobs newer
// Anki versions use (media index, note type and template settings).
// Returns field number -> list of raw values (numbers for varints, bytes otherwise).

export type ProtoFields = Map<number, (number | Uint8Array)[]>

export function readProto(buf: Uint8Array): ProtoFields {
  const fields: ProtoFields = new Map()
  let pos = 0

  const varint = (): number => {
    let result = 0
    let multiplier = 1
    for (;;) {
      if (pos >= buf.length) throw new Error('protobuf: truncated varint')
      const byte = buf[pos++]
      result += (byte & 0x7f) * multiplier // multiply instead of shift: stays correct past 32 bits
      if ((byte & 0x80) === 0) return result
      multiplier *= 128
    }
  }

  while (pos < buf.length) {
    const key = varint()
    const field = Math.floor(key / 8)
    const wireType = key & 7
    let value: number | Uint8Array
    if (wireType === 0) value = varint()
    else if (wireType === 2) {
      const len = varint()
      value = buf.subarray(pos, pos + len)
      pos += len
    } else if (wireType === 1) { value = buf.subarray(pos, pos + 8); pos += 8 }
    else if (wireType === 5) { value = buf.subarray(pos, pos + 4); pos += 4 }
    else throw new Error(`protobuf: unsupported wire type ${wireType}`)

    const list = fields.get(field)
    if (list) list.push(value)
    else fields.set(field, [value])
  }
  return fields
}

const decoder = new TextDecoder()

export function protoString(fields: ProtoFields, n: number): string | undefined {
  const v = fields.get(n)?.[0]
  return v instanceof Uint8Array ? decoder.decode(v) : undefined
}

export function protoNumber(fields: ProtoFields, n: number): number | undefined {
  const v = fields.get(n)?.[0]
  return typeof v === 'number' ? v : undefined
}

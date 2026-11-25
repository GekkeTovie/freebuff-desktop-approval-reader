// Minimal, dependency-free reader/writer for the Electron asar format.
//
// Layout (all integers little-endian):
//   [0..3]   u32  4
//   [4..7]   u32  headerSize
//   [8..11]  u32  headerSize - 4
//   [12..15] u32  jsonLength
//   [16..]        header JSON, zero-padded so the data section starts 4-byte aligned
//   [8+headerSize ..] concatenated file data
//
// The writer mutates the header object that was parsed from an existing archive, so
// field order and any field we do not own (executable flags, unpacked markers, ...)
// survive a repack unchanged.

import fs from 'node:fs'
import crypto from 'node:crypto'

export const BLOCK_SIZE = 4 * 1024 * 1024

export function readArchive(asarPath) {
  const fd = fs.openSync(asarPath, 'r')
  try {
    const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0)
    const headerSize = head.readUInt32LE(4)
    const jsonLength = head.readUInt32LE(12)
    const json = Buffer.alloc(jsonLength)
    fs.readSync(fd, json, 0, jsonLength, 16)
    const header = JSON.parse(json.toString('utf8'))
    const dataBase = 8 + headerSize
    const fileSize = fs.fstatSync(fd).size

    const files = walkFiles(header).map(({ path, entry }) => {
      const data = Buffer.alloc(entry.size)
      if (entry.size > 0) fs.readSync(fd, data, 0, entry.size, dataBase + Number(entry.offset))
      return { path, entry, data }
    })
    const contents = new Map(files.map(({ path, data }) => [path, data]))
    return {
      header,
      jsonLength,
      headerSize,
      dataBase,
      fileSize,
      files,
      contents,
      get: (filePath) => contents.get(filePath),
    }
  } finally {
    fs.closeSync(fd)
  }
}

/** Depth-first list of { path, entry } in serialized header order. */
export function walkFiles(header) {
  const out = []
  const visit = (node, prefix) => {
    for (const [name, value] of Object.entries(node.files || {})) {
      const full = prefix ? `${prefix}/${name}` : name
      if (value.files) visit(value, full)
      else out.push({ path: full, entry: value })
    }
  }
  visit(header, '')
  return out
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function integrityFor(buffer) {
  const blocks = []
  for (let offset = 0; offset < buffer.length; offset += BLOCK_SIZE) {
    blocks.push(sha256(buffer.subarray(offset, offset + BLOCK_SIZE)))
  }
  if (blocks.length === 0) blocks.push(sha256(Buffer.alloc(0)))
  return { algorithm: 'SHA256', hash: sha256(buffer), blockSize: BLOCK_SIZE, blocks }
}

/**
 * Serialize an archive from the header plus a path -> Buffer map.
 * Every leaf in the header must have content; offsets and integrity are recomputed.
 */
export function packArchive(header, contents) {
  const files = walkFiles(header)
  let dataLength = 0
  for (const { path, entry } of files) {
    const data = contents.get(path)
    if (!data) throw new Error(`missing content for ${path}`)

    // Assign into existing keys so JSON.stringify keeps the original field order.
    // Untouched files keep their original entry verbatim: only new content (and files
    // whose recorded hash no longer matches) get fresh size/integrity values, so an
    // unchanged repack stays byte-identical to the archive we read.
    const hash = sha256(data)
    const recorded = entry.integrity?.hash
    if (entry.size !== data.length || recorded !== hash) {
      entry.size = data.length
      if (entry.integrity) {
        const next = integrityFor(data)
        entry.integrity.algorithm = next.algorithm
        entry.integrity.hash = next.hash
        entry.integrity.blockSize = next.blockSize
        entry.integrity.blocks = next.blocks
      } else {
        entry.integrity = integrityFor(data)
      }
    }
    entry.offset = String(dataLength)
    dataLength += data.length
  }

  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const padding = (4 - (json.length % 4)) % 4
  const headerSize = json.length + padding + 8
  const dataBase = 8 + headerSize

  const prefix = Buffer.alloc(16)
  prefix.writeUInt32LE(4, 0)
  prefix.writeUInt32LE(headerSize, 4)
  prefix.writeUInt32LE(headerSize - 4, 8)
  prefix.writeUInt32LE(json.length, 12)

  const archive = Buffer.alloc(dataBase + dataLength)
  prefix.copy(archive, 0)
  json.copy(archive, 16)
  let offset = dataBase
  for (const { path } of files) {
    const data = contents.get(path)
    data.copy(archive, offset)
    offset += data.length
  }
  return archive
}

export function readAllContents(archive) {
  return new Map(archive.files.map(({ path, data }) => [path, data]))
}

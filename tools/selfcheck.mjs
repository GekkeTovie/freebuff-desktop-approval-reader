#!/usr/bin/env node
// Proves the packer is byte-exact: repacking an untouched app.asar must reproduce
// its header prefix and every file byte for byte.
//
//   node tools/selfcheck.mjs <path to app.asar> [scratch dir]

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readArchive, readAllContents, packArchive, walkFiles } from './asar.mjs'

const asarPath = process.argv[2]
if (!asarPath) {
  console.error('usage: node tools/selfcheck.mjs <app.asar> [scratch dir]')
  process.exit(2)
}

const original = readArchive(asarPath)
const contents = readAllContents(original)
const packed = packArchive(original.header, contents)

const problems = []

const fd = fs.openSync(asarPath, 'r')
const originalPrefix = Buffer.alloc(original.dataBase)
fs.readSync(fd, originalPrefix, 0, original.dataBase, 0)
fs.closeSync(fd)

if (!originalPrefix.equals(packed.subarray(0, original.dataBase))) {
  problems.push('header prefix differs from the original archive')
}
if (packed.length !== original.fileSize) {
  problems.push(`size ${original.fileSize} -> ${packed.length}`)
}

const tmp = path.join(process.argv[3] || os.tmpdir(), `selfcheck-${process.pid}.asar`)
fs.writeFileSync(tmp, packed)
const reread = readArchive(tmp)
const rereadContents = readAllContents(reread)
fs.rmSync(tmp, { force: true })

for (const { path: file } of walkFiles(original.header)) {
  const before = contents.get(file)
  const after = rereadContents.get(file)
  if (!after) problems.push(`missing after round trip: ${file}`)
  else if (!before.equals(after)) problems.push(`differs after round trip: ${file}`)
}

console.log(`entries:  ${walkFiles(original.header).length}`)
console.log(`original: ${original.fileSize} bytes, repacked: ${packed.length} bytes`)
if (problems.length > 0) {
  console.error('\nSELFCHECK FAILED:')
  for (const problem of problems.slice(0, 20)) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('SELFCHECK OK: header prefix identical, all files byte-identical after round trip')

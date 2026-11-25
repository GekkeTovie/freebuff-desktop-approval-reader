#!/usr/bin/env node
// Patches one text file inside Freebuff Desktop's app.asar: electron/main.cjs gets a
// small block that injects approval-reader.css into every window.
//
//   node tools/patch.mjs --asar <app.asar> --css approval-reader.css --dry-run
//   node tools/patch.mjs --asar <app.asar> --css approval-reader.css --apply
//   node tools/patch.mjs --check <app.asar>
//
// --dry-run  writes <asar>.patched next to the archive and reports, changes nothing.
// --apply    replaces the archive after the same checks pass.
// --check    verifies an already patched archive (or reports that it is untouched).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { readArchive, walkFiles, packArchive, readAllContents, sha256 } from './asar.mjs'

export const MARKER = 'FREEBUFF_APPROVAL_READER'
const TARGET = 'electron/main.cjs'
const ANCHOR = 'if (app.isPackaged && hasRemoteDebuggingSwitch(process.argv)) app.exit(1)'

function parseArgs(argv) {
  const args = { mode: 'dry-run' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') args.mode = 'apply'
    else if (arg === '--dry-run') args.mode = 'dry-run'
    else if (arg === '--check') {
      args.mode = 'check'
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) args.asar = argv[++i]
    } else if (arg === '--asar') args.asar = argv[++i]
    else if (arg === '--css') args.css = argv[++i]
    else if (arg === '--out') args.out = argv[++i]
    else throw new Error(`unknown argument: ${arg}`)
  }
  return args
}

export function injectionBlock(css, newline = '\n') {
  const lines = [
    '',
    `// ${MARKER}: local presentation patch — larger, taller approval/plan request card.`,
    '// Injects one stylesheet per window. No behaviour change: approval still happens in the UI.',
    'try {',
    `  const APPROVAL_READER_CSS = ${JSON.stringify(css)}`,
    '  const applyApprovalReader = (wc) => {',
    '    if (!wc || wc.isDestroyed()) return',
    '    try { void wc.insertCSS(APPROVAL_READER_CSS).catch(() => {}) } catch {}',
    '  }',
    "  app.on('web-contents-created', (_event, wc) => {",
    "    wc.on('did-finish-load', () => applyApprovalReader(wc))",
    "    wc.on('did-navigate-in-page', () => applyApprovalReader(wc))",
    '    if (!wc.isLoading()) applyApprovalReader(wc)',
    '  })',
    '  app',
    '    .whenReady()',
    '    .then(() => {',
    '      for (const wc of webContents.getAllWebContents()) applyApprovalReader(wc)',
    '    })',
    '    .catch(() => {})',
    '} catch {}',
    '',
  ]
  return lines.join(newline)
}

export function patchMain(source, css) {
  if (source.includes(MARKER)) return { changed: false, reason: 'already patched', source }
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const at = source.indexOf(ANCHOR)
  if (at === -1) return { changed: false, reason: 'anchor line not found', source }
  const lineEnd = source.indexOf('\n', at)
  if (lineEnd === -1) return { changed: false, reason: 'anchor line has no end', source }
  const patched = source.slice(0, lineEnd + 1) + injectionBlock(css, newline) + source.slice(lineEnd + 1)
  return { changed: true, source: patched }
}

function diffReport(archiveA, archiveB, targetPath) {
  const problems = []
  if (archiveA.contents.size !== archiveB.contents.size) {
    problems.push(`entry count ${archiveA.contents.size} -> ${archiveB.contents.size}`)
  }
  for (const [file, buffer] of archiveA.contents) {
    if (file === targetPath) continue
    const other = archiveB.contents.get(file)
    if (!other) {
      problems.push(`missing after repack: ${file}`)
      continue
    }
    if (sha256(buffer) !== sha256(other)) problems.push(`content changed: ${file}`)
  }
  return problems
}

function checkPatched(asarPath) {
  const archive = readArchive(asarPath)
  const source = archive.get(TARGET)
  if (!source) throw new Error(`${TARGET} not found in ${asarPath}`)
  return { patched: source.toString('utf8').includes(MARKER), source }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.asar) throw new Error('--asar <path to app.asar> is required')

  if (args.mode === 'check') {
    const { patched } = checkPatched(args.asar)
    console.log(patched ? 'patch present' : 'patch absent')
    process.exit(patched ? 0 : 1)
  }

  if (!args.css) throw new Error('--css <stylesheet> is required')
  const css = fs.readFileSync(args.css, 'utf8')
  const original = readArchive(args.asar)
  const contents = readAllContents(original)
  const targetKey = [...contents.keys()].find((key) => key === TARGET)
  if (!targetKey) throw new Error(`${TARGET} not found in ${args.asar}`)

  const before = contents.get(targetKey).toString('utf8')
  const result = patchMain(before, css)
  if (!result.changed) throw new Error(`could not patch ${TARGET}: ${result.reason}`)
  contents.set(targetKey, Buffer.from(result.source, 'utf8'))

  const packed = packArchive(original.header, contents)
  const outPath = args.out || `${args.asar}.patched`
  fs.writeFileSync(outPath, packed)

  // Verify what we actually wrote, not what we intended to write.
  const repacked = readArchive(outPath)
  const problems = diffReport(original, repacked, targetKey)
  const patchedSource = repacked.get(TARGET).toString('utf8')
  if (!patchedSource.includes(MARKER)) problems.push('marker missing from patched main.cjs')

  const tempFile = path.join(os.tmpdir(), `approval-reader-main-${process.pid}.cjs`)
  fs.writeFileSync(tempFile, patchedSource)
  try {
    execFileSync(process.execPath, ['--check', tempFile], { stdio: 'pipe' })
  } catch (error) {
    problems.push(`node --check failed: ${String(error.stderr || error.message).slice(0, 400)}`)
  } finally {
    fs.rmSync(tempFile, { force: true })
  }

  const bytesDelta = packed.length - original.fileSize
  console.log(`source:      ${args.asar}`)
  console.log(`patched file:${TARGET} (${before.length} -> ${result.source.length} bytes)`)
  console.log(`archive:     ${packed.length} bytes (${bytesDelta >= 0 ? '+' : ''}${bytesDelta})`)
  console.log(`entries:     ${walkFiles(original.header).length} -> ${walkFiles(repacked.header).length}`)
  console.log(`written:     ${outPath}`)

  if (problems.length > 0) {
    console.error('\nFAILED:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log('\nverification: repacked archive parses, every other entry is byte-identical, patched main.cjs passes node --check')

  if (args.mode === 'apply') {
    fs.copyFileSync(outPath, args.asar)
    fs.rmSync(outPath, { force: true })
    const applied = checkPatched(args.asar)
    console.log(`applied to ${args.asar}: patch ${applied.patched ? 'present' : 'MISSING'}`)
    if (!applied.patched) process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(`error: ${error.message}`)
    process.exit(1)
  }
}

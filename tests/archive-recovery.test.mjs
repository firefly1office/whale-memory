import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exportArchive, importArchive, verifyArchive } from '../packages/core/lib/archive.js'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-recovery-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  const target = path.join(root, 'target')
  fs.mkdirSync(source)
  fs.mkdirSync(target)
  fs.writeFileSync(path.join(source, 'a.txt'), 'new-a')
  fs.writeFileSync(path.join(source, 'b.txt'), 'new-b')
  fs.writeFileSync(path.join(target, 'original.txt'), 'old-memory')
  const archive = exportArchive(source, path.join(root, 'exports')).dir
  return { root, source, target, archive }
}

test('forced import preserves the original directory when copying fails midway', (t) => {
  const { target, archive } = fixture(t)
  const copy = fs.copyFileSync
  t.mock.method(fs, 'copyFileSync', (src, dest, ...args) => {
    if (path.basename(src) === 'b.txt') throw new Error('simulated disk failure')
    return copy(src, dest, ...args)
  })
  assert.throws(() => importArchive(archive, target, { force: true }), /simulated disk failure/)
  assert.deepEqual(fs.readdirSync(target), ['original.txt'])
  assert.equal(fs.readFileSync(path.join(target, 'original.txt'), 'utf8'), 'old-memory')
})

test('import rejects a backup nested inside its target before moving any data', (t) => {
  const { target, archive } = fixture(t)
  const nested = path.join(target, 'backup')
  fs.cpSync(archive, nested, { recursive: true })
  assert.throws(() => importArchive(nested, target, { force: true }), /overlap|inside/i)
  assert.equal(fs.readFileSync(path.join(target, 'original.txt'), 'utf8'), 'old-memory')
  assert.ok(fs.existsSync(path.join(nested, 'manifest.json')))
})

test('verify rejects an archive entry that traverses a directory junction', (t) => {
  const { root, archive } = fixture(t)
  const outside = path.join(root, 'outside')
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'a.txt'), 'new-a')
  fs.symlinkSync(outside, path.join(archive, 'linked'), 'junction')
  const manifestFile = path.join(archive, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  manifest.files[0].name = 'linked/a.txt'
  fs.writeFileSync(manifestFile, JSON.stringify(manifest))
  assert.throws(() => verifyArchive(archive), /link|outside|escap/i)
})

test('verify rejects a declared byte count that does not match the file', (t) => {
  const { archive } = fixture(t)
  const file = path.join(archive, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  manifest.files[0].bytes += 1
  fs.writeFileSync(file, JSON.stringify(manifest))
  assert.throws(() => verifyArchive(archive), /size|bytes/i)
})

test('forced import restores the old directory if installing the staged copy fails', (t) => {
  const { target, archive } = fixture(t)
  const rename = fs.renameSync
  t.mock.method(fs, 'renameSync', (src, dest) => {
    if (String(src).includes('.import-stage-')) throw new Error('simulated rename failure')
    return rename(src, dest)
  })
  assert.throws(() => importArchive(archive, target, { force: true }), /simulated rename failure/)
  assert.deepEqual(fs.readdirSync(target), ['original.txt'])
})

test('import detects a changed source after initial verification before replacing memory', (t) => {
  const { target, archive } = fixture(t)
  const copy = fs.copyFileSync
  t.mock.method(fs, 'copyFileSync', (src, dest, ...args) => {
    if (path.basename(src) === 'b.txt') fs.writeFileSync(src, 'changed')
    return copy(src, dest, ...args)
  })
  assert.throws(() => importArchive(archive, target, { force: true }), /changed during import/)
  assert.deepEqual(fs.readdirSync(target), ['original.txt'])
})

test('overlap detection resolves directory junctions before export and import', (t) => {
  const { root, source, archive } = fixture(t)
  const alias = path.join(root, 'alias')
  fs.symlinkSync(source, alias, 'junction')
  assert.throws(() => exportArchive(source, alias, { name: 'nested' }), /inside/)
  const nested = path.join(source, 'backup')
  fs.cpSync(archive, nested, { recursive: true })
  assert.throws(() => importArchive(nested, alias, { force: true }), /overlap/)
  assert.equal(fs.readFileSync(path.join(source, 'a.txt'), 'utf8'), 'new-a')
})

test('repeated forced imports retain distinct backups and leave no staging files', (t) => {
  const { root, target, archive } = fixture(t)
  const first = importArchive(archive, target, { force: true })
  const second = importArchive(archive, target, { force: true })
  assert.notEqual(first.backup, second.backup)
  assert.equal(fs.readFileSync(path.join(first.backup, 'original.txt'), 'utf8'), 'old-memory')
  assert.equal(fs.readFileSync(path.join(second.backup, 'a.txt'), 'utf8'), 'new-a')
  assert.equal(fs.readdirSync(root).some(name => name.includes('.import-stage-')), false)
})

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import {
  assertUnique,
  parseOfficialCategories,
  parseSymbols,
  toComponentName,
  toRegistryName,
} from './core.mjs'

test('parses symbol geometry without rewriting paths', () => {
  const [icon] = parseSymbols(
    '<svg><symbol id="FaceHeartEyes" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1 2Z"/></symbol></svg>',
    'fixture.svg',
  )
  assert.deepEqual(icon, {
    linearName: 'FaceHeartEyes',
    viewBox: '0 0 16 16',
    body: '<path fill-rule="evenodd" d="M1 2Z"/>',
    source: 'fixture.svg',
  })
})

test('creates stable public names', () => {
  assert.equal(toRegistryName('FaceHeartEyes'), 'face-heart-eyes')
  assert.equal(toRegistryName('GitHub'), 'git-hub')
  assert.equal(toRegistryName('LinearAi'), 'linear-ai')
  assert.equal(toRegistryName('Clock--outline'), 'clock-legacy-outline')
  assert.equal(toComponentName('GitHub'), 'LinearGitHubIcon')
  assert.equal(toComponentName('Clock--outline'), 'LinearClockLegacyOutlineIcon')
})

test('parses Linear official category assignments', () => {
  const source = 'S={[y.Face]:b.FACES_PEOPLE_HEALTH,[y.GitHub]:b.COMPANIES}'
  assert.deepEqual([...parseOfficialCategories(source)], [
    ['Face', 'faces-people-health'],
    ['GitHub', 'companies'],
  ])
})

test('rejects duplicate generated names', () => {
  assert.throws(
    () => assertUnique([{ name: 'face' }, { name: 'face' }], 'name'),
    /Duplicate name: face/,
  )
})

test('real archive resolves to 301 unique officially categorized icons', async () => {
  const root = path.resolve('assets/linear-icon-system/raw')
  const files = ['svg-1.svg', 'svg-2.svg', 'svg-3.svg']
  const symbols = (await Promise.all(files.map(async (file) =>
    parseSymbols(await fs.readFile(path.join(root, file), 'utf8'), file),
  ))).flat()
  const unique = new Map(symbols.map((symbol) => [symbol.linearName, symbol]))
  const moduleSource = await fs.readFile(
    path.join(root, 'modules/EmojiContainer.CeAZEvLX.js'),
    'utf8',
  )
  const categories = parseOfficialCategories(moduleSource)
  assert.equal(unique.size, 301)
  assert.deepEqual(
    [...unique.keys()].filter((name) => !categories.has(name)).sort(),
    [
      'AiWriting', 'Alarm', 'AlarmDelete', 'Anonymous', 'BarGraph', 'Biscuit',
      'ChatLine', 'Circle', 'Clock', 'Clock--outline', 'EmptyCircle',
      'ExclamationMark', 'Flag', 'GooglePlay', 'LinearAi', 'QuestionMark',
      'Ramp', 'Report', 'Resolved', 'ResolvedChat', 'ScatterPlot', 'SmallLock',
      'SoundMuted', 'Starred', 'Stopwatch',
    ].sort(),
  )
})

test('generated manifest contains all 301 records', async () => {
  const manifest = JSON.parse(
    await fs.readFile('assets/linear-icon-system/manifest.json', 'utf8'),
  )
  assert.equal(manifest.count, 301)
})

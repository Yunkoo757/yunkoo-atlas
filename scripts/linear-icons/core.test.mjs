import assert from 'node:assert/strict'
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

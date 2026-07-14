import type { StorageAdapter } from '@/storage/adapter'
import {
  normalizeNoteForStorage,
  resolveNoteForDisplay,
  resolveNoteForDisplayResult,
} from '@/storage/assets'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const missingAssetAdapter: StorageAdapter = {
  async open() {},
  async getManifest() {
    return {
      schemaVersion: 1,
      libraryId: 'test',
      createdAt: '2026-06-01T00:00:00.000Z',
    }
  },
  async loadSnapshot() {
    return null
  },
  async saveSnapshot() {},
  async saveAsset() {
    return 'asset-1'
  },
  async getAssetObjectUrl() {
    return null
  },
  async getAssetForExport() {
    return null
  },
  async getAssetStats() {
    return { count: 0, totalBytes: 0, missingCount: 0 }
  },
  async importAssets() {},
  async commitImport() {},
}

export async function testMissingAssetRendersDiagnosticPlaceholder(): Promise<void> {
  const html = await resolveNoteForDisplay(
    '<p><img src="journal-asset://missing-1"></p>',
    missingAssetAdapter,
  )
  assert(!html.includes('journal-asset://missing-1'), 'missing asset protocol is not left as a broken img')
  assert(html.includes('图片附件缺失'), 'missing asset renders a clear diagnostic placeholder')
}

export async function testMissingAssetMarksTheResolvedNoteAsReadOnly(): Promise<void> {
  const result = await resolveNoteForDisplayResult(
    '<p>正文<img src="journal-asset://missing-1"></p>',
    missingAssetAdapter,
  )

  assert(!result.editable, 'a note with missing referenced assets must not become editable')
  assert(result.html.includes('正文'), 'the degraded note should still retain its written body')
  assert(result.html.includes('图片附件缺失'), 'the degraded note should explain the missing attachment')
}

export async function testInvalidBlobImageIsNotPersistedAsBlobUrl(): Promise<void> {
  const html = await normalizeNoteForStorage(
    '<p><img src="blob:http://127.0.0.1:5177/missing-blob"></p>',
    missingAssetAdapter,
  )
  assert(!html.includes('blob:http://127.0.0.1:5177/missing-blob'), 'invalid blob url is not persisted')
  assert(html.includes('图片未能保存'), 'invalid blob image renders a save-failure placeholder')
}

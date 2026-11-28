import { openJournalDatabase, REQUIRED_STORES } from './indexedDbSchema'
import { BROWSER_DATABASE_NAME } from './storageIdentity'

const LEGACY_BROWSER_DATABASE_NAME = 'linear-journal-v3'
export const LEGACY_LOCAL_STORAGE_KEY = 'linear-journal'

type StoreName = (typeof REQUIRED_STORES)[number]
type MigrationResult = 'copied' | 'skipped' | 'unavailable'
type StoredEntry = { key: IDBValidKey; value: unknown }

async function databaseExists(factory: IDBFactory, name: string): Promise<boolean> {
  if (typeof factory.databases !== 'function') return false
  const databases = await factory.databases()
  return databases.some((database) => database.name === name)
}

function openExistingDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name)
    request.onupgradeneeded = () => {
      request.transaction?.abort()
      reject(new Error(`Compatibility source database disappeared: ${name}`))
    }
    request.onerror = () => reject(request.error ?? new Error(`Cannot open database: ${name}`))
    request.onsuccess = () => resolve(request.result)
  })
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Identity migration failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Identity migration aborted'))
  })
}

function readEntries(store: IDBObjectStore): Promise<StoredEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: StoredEntry[] = []
    const request = store.openCursor()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve(entries)
        return
      }
      entries.push({ key: cursor.primaryKey, value: cursor.value })
      cursor.continue()
    }
  })
}

async function readSourceEntries(database: IDBDatabase): Promise<Record<StoreName, StoredEntry[]>> {
  const transaction = database.transaction([...REQUIRED_STORES], 'readonly')
  const done = transactionDone(transaction)
  const [snapshot, assets, meta] = await Promise.all(
    REQUIRED_STORES.map((storeName) => readEntries(transaction.objectStore(storeName))),
  )
  await done
  return { snapshot, assets, meta }
}

async function readMainSnapshot(database: IDBDatabase): Promise<unknown> {
  const transaction = database.transaction('snapshot', 'readonly')
  const done = transactionDone(transaction)
  const snapshot = await requestValue(transaction.objectStore('snapshot').get('main'))
  await done
  return snapshot
}

async function copyToEmptyTarget(
  database: IDBDatabase,
  entries: Record<StoreName, StoredEntry[]>,
): Promise<'copied' | 'skipped'> {
  const transaction = database.transaction([...REQUIRED_STORES], 'readwrite')
  const done = transactionDone(transaction)
  const current = transaction.objectStore('snapshot').get('main')
  let copied = false
  let writeError: unknown
  current.onsuccess = () => {
    if (current.result !== undefined) return
    try {
      for (const storeName of REQUIRED_STORES) {
        const store = transaction.objectStore(storeName)
        for (const entry of entries[storeName]) {
          if (store.keyPath === null) store.put(entry.value, entry.key)
          else store.put(entry.value)
        }
      }
      copied = true
    } catch (error) {
      writeError = error
      transaction.abort()
    }
  }
  try {
    await done
  } catch (error) {
    throw writeError ?? error
  }
  return copied ? 'copied' : 'skipped'
}

export async function migrateLegacyBrowserIdentity(
  factory: IDBFactory,
): Promise<MigrationResult> {
  if (!(await databaseExists(factory, LEGACY_BROWSER_DATABASE_NAME))) return 'unavailable'

  const source = await openExistingDatabase(factory, LEGACY_BROWSER_DATABASE_NAME)
  let target: IDBDatabase | null = null
  try {
    if (REQUIRED_STORES.some((storeName) => !source.objectStoreNames.contains(storeName))) {
      return 'unavailable'
    }
    const sourceSnapshot = await readMainSnapshot(source)
    if (sourceSnapshot === undefined) return 'unavailable'

    target = await openJournalDatabase(factory, BROWSER_DATABASE_NAME, () => new Error('Target database repair is blocked'))
    if (await readMainSnapshot(target) !== undefined) return 'skipped'

    const entries = await readSourceEntries(source)
    if (!entries.snapshot.some(entry => entry.key === 'main' && entry.value !== undefined)) return 'unavailable'
    return await copyToEmptyTarget(target, entries)
  } finally {
    target?.close()
    source.close()
  }
}

export const STORE_SNAPSHOT = 'snapshot'
export const STORE_ASSETS = 'assets'
export const STORE_META = 'meta'
export const REQUIRED_STORES = [STORE_SNAPSHOT, STORE_ASSETS, STORE_META] as const

function createMissingStores(db: IDBDatabase): void {
  for (const store of REQUIRED_STORES) {
    if (!db.objectStoreNames.contains(store)) {
      db.createObjectStore(store, store === STORE_ASSETS ? { keyPath: 'id' } : undefined)
    }
  }
}

export function openJournalDatabase(
  factory: IDBFactory,
  name: string,
  blockedError: () => Error,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name)
    open.onerror = () => reject(open.error ?? new Error(`Cannot open database: ${name}`))
    open.onupgradeneeded = () => createMissingStores(open.result)
    open.onsuccess = () => {
      const db = open.result
      if (REQUIRED_STORES.every(store => db.objectStoreNames.contains(store))) {
        resolve(db)
        return
      }

      const version = db.version + 1
      db.close()
      const repair = factory.open(name, version)
      let abandoned = false
      repair.onblocked = () => {
        abandoned = true
        reject(blockedError())
      }
      repair.onerror = () => reject(repair.error ?? new Error(`Cannot repair database: ${name}`))
      repair.onupgradeneeded = () => {
        // IndexedDB keeps a blocked open request queued after its caller has received the error.
        if (abandoned) repair.transaction?.abort()
        else createMissingStores(repair.result)
      }
      repair.onsuccess = () => {
        if (abandoned) repair.result.close()
        else resolve(repair.result)
      }
    }
  })
}

import type { StorageAdapter } from '@/storage/adapter'
import { getElectronAdapter } from '@/storage/electronAdapter'
import { getIndexedDbAdapter } from '@/storage/indexedDbAdapter'
import { isElectron } from '@/storage/runtime'

let storage: StorageAdapter | null = null

export function getStorage(): StorageAdapter {
  if (!storage) storage = isElectron() ? getElectronAdapter() : getIndexedDbAdapter()
  return storage
}

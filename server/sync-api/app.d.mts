import type { AddressInfo } from 'node:net'

export interface AtlasSyncServer {
  listen(options?: { host?: string; port?: number }): Promise<AddressInfo>
  close(): Promise<void>
}

export function createAtlasSyncServer(options: {
  databasePath: string
  token: string
  assetRoot?: string
}): AtlasSyncServer

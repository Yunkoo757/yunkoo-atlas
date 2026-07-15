import { createAtlasSyncServer } from './app.mjs'

const token = process.env.ATLAS_SYNC_TOKEN
if (!token) throw new Error('ATLAS_SYNC_TOKEN is required')

const instance = createAtlasSyncServer({
  databasePath: process.env.ATLAS_SYNC_DATABASE ?? '/data/atlas-sync.db',
  token,
})
const address = await instance.listen({
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 8787),
})
console.log(`Atlas Sync API listening on ${address.address}:${address.port}`)

let closing = false
async function close() {
  if (closing) return
  closing = true
  await instance.close()
  process.exit(0)
}
process.on('SIGINT', close)
process.on('SIGTERM', close)

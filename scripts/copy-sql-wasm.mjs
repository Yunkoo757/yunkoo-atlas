import { copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
copyFileSync(
  join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'),
  join(root, 'dist-electron/sql-wasm.wasm'),
)
console.log('Copied sql-wasm.wasm → dist-electron/')

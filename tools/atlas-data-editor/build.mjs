import { build } from 'vite'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import path from 'node:path'
const root = path.resolve('tools/atlas-data-editor')
const out = path.resolve('release/atlas-data-editor')
await mkdir(out, { recursive: true })
await build({ configFile: false, root, resolve: { alias: { '@': path.resolve('src') } }, define: { 'process.env.NODE_ENV': '"production"' }, build: { outDir: out, emptyOutDir: false, lib: { entry: path.join(root, 'app.ts'), name: 'AtlasDataEditor', formats: ['iife'], fileName: () => 'editor.js' } } })
const wasm = await readFile('node_modules/sql.js/dist/sql-wasm.wasm')
await writeFile(path.join(out, 'sqlite-bytes.js'), `window.ATLAS_SQLITE_BYTES="${wasm.toString('base64')}";`, 'utf8')
await copyFile('node_modules/sql.js/dist/sql-wasm.js', path.join(out, 'sqlite.js'))
await copyFile('src/styles/tokens.css', path.join(out, 'tokens.css'))
await copyFile('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', path.join(out, 'inter.woff2'))
for (const file of ['index.html', 'editor.css', 'README.md']) await copyFile(path.join(root, file), path.join(out, file))
console.log(out)

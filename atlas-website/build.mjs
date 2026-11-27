import { cpSync, copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { websiteCopyPlan } from './public-files.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const output = path.join(root, 'dist')
if (path.dirname(output) !== root || path.basename(output) !== 'dist') throw new Error('Invalid generated output path')
const copies = websiteCopyPlan(root)
for (const { source, directory, requiredChildren } of copies) {
  const stat = statSync(source)
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error('Invalid website source: ' + source)
  for (const child of requiredChildren) {
    const filename = path.join(source, child)
    if (!statSync(filename).isFile()) throw new Error('Invalid website source: ' + filename)
  }
}
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })
for (const { source, relative, directory } of copies) {
  const target = path.join(output, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  if (directory) cpSync(source, target, { recursive: true })
  else copyFileSync(source, target)
}
console.log('Built standalone static website and /guide/ at', output)

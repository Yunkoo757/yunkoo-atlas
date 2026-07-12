/**
 * Generate Electron / favicon assets from demos/icons/atlas-icon-e.svg
 * Usage: node scripts/generate-app-icon.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const svgPath = path.join(root, 'demos/icons/atlas-icon-e.svg')
const buildDir = path.join(root, 'build')
const publicDir = path.join(root, 'public')

/** Pack PNG buffers into a multi-size .ico (PNG-in-ICO, Vista+) */
function pngsToIco(pngBuffers) {
  const count = pngBuffers.length
  const headerSize = 6 + count * 16
  let offset = headerSize
  const entries = []
  for (const buf of pngBuffers) {
    const meta = readPngSize(buf)
    entries.push({ buf, width: meta.width, height: meta.height, offset, size: buf.length })
    offset += buf.length
  }
  const out = Buffer.alloc(offset)
  out.writeUInt16LE(0, 0)
  out.writeUInt16LE(1, 2)
  out.writeUInt16LE(count, 4)
  let entryAt = 6
  for (const e of entries) {
    out.writeUInt8(e.width >= 256 ? 0 : e.width, entryAt)
    out.writeUInt8(e.height >= 256 ? 0 : e.height, entryAt + 1)
    out.writeUInt8(0, entryAt + 2)
    out.writeUInt8(0, entryAt + 3)
    out.writeUInt16LE(1, entryAt + 4)
    out.writeUInt16LE(32, entryAt + 6)
    out.writeUInt32LE(e.size, entryAt + 8)
    out.writeUInt32LE(e.offset, entryAt + 12)
    e.buf.copy(out, e.offset)
    entryAt += 16
  }
  return out
}

function readPngSize(buf) {
  if (buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('Not a PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

async function main() {
  if (!fs.existsSync(svgPath)) throw new Error(`Missing ${svgPath}`)
  fs.mkdirSync(buildDir, { recursive: true })
  fs.mkdirSync(publicDir, { recursive: true })

  const svg = fs.readFileSync(svgPath)
  // Canonical source copy in build/
  fs.copyFileSync(svgPath, path.join(buildDir, 'icon.svg'))

  const master = sharp(svg, { density: 384 })
  const png512 = await master.clone().resize(512, 512).png().toBuffer()
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png512)

  // Web favicon + apple touch + runtime window icon (copied into dist/)
  const png32 = await sharp(svg, { density: 384 }).resize(32, 32).png().toBuffer()
  const png180 = await sharp(svg, { density: 384 }).resize(180, 180).png().toBuffer()
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), svg)
  fs.writeFileSync(path.join(publicDir, 'favicon-32.png'), png32)
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), png180)
  fs.writeFileSync(path.join(publicDir, 'icon.png'), png512)

  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoPngs = []
  for (const size of icoSizes) {
    icoPngs.push(await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer())
  }
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), pngsToIco(icoPngs))

  console.log('Generated:')
  console.log('  build/icon.svg')
  console.log('  build/icon.png (512)')
  console.log('  build/icon.ico (16–256)')
  console.log('  public/favicon.svg')
  console.log('  public/favicon-32.png')
  console.log('  public/apple-touch-icon.png')
  console.log('  public/icon.png (512, window)')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

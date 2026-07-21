/**
 * Generate Electron / favicon / NSIS installer assets from demos/icons/atlas-icon-e.svg
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

const BRAND = {
  bg: '#12141a',
  accent: '#5e6ad2',
  ink: '#e8eaf6',
  mute: '#9aa3b5',
}

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

/** NSIS 需要 24-bit BMP；从 RGBA raw 编码（无 alpha）。 */
function encodeBmp24(width, height, rgba) {
  const rowStride = Math.ceil((width * 3) / 4) * 4
  const pixelBytes = rowStride * height
  const fileSize = 54 + pixelBytes
  const out = Buffer.alloc(fileSize)

  out.write('BM', 0)
  out.writeUInt32LE(fileSize, 2)
  out.writeUInt32LE(0, 6)
  out.writeUInt32LE(54, 10)

  out.writeUInt32LE(40, 14)
  out.writeInt32LE(width, 18)
  out.writeInt32LE(height, 22)
  out.writeUInt16LE(1, 26)
  out.writeUInt16LE(24, 28)
  out.writeUInt32LE(0, 30)
  out.writeUInt32LE(pixelBytes, 34)
  out.writeInt32LE(2835, 38)
  out.writeInt32LE(2835, 42)
  out.writeUInt32LE(0, 46)
  out.writeUInt32LE(0, 50)

  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y
    const destRow = 54 + y * rowStride
    for (let x = 0; x < width; x++) {
      const src = (srcY * width + x) * 4
      const dest = destRow + x * 3
      out[dest] = rgba[src + 2]
      out[dest + 1] = rgba[src + 1]
      out[dest + 2] = rgba[src]
    }
  }
  return out
}

async function svgToBmp24(svg, width, height) {
  const { data } = await sharp(Buffer.from(svg))
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return encodeBmp24(width, height, data)
}

/** 欢迎/完成页左侧图：164×314（NSIS MUI_WELCOMEFINISHPAGE_BITMAP） */
function installerSidebarSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <linearGradient id="glow" x1="82" y1="40" x2="82" y2="220" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${BRAND.accent}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${BRAND.bg}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="164" height="314" fill="${BRAND.bg}"/>
  <rect width="164" height="314" fill="url(#glow)"/>
  <g transform="translate(34 78)">
    <rect width="96" height="96" rx="22" fill="#161922"/>
    <path d="M28.5 64.5 C28.5 34.5 67.5 30 67.5 30" fill="none" stroke="${BRAND.accent}" stroke-width="6" stroke-linecap="round"/>
    <path d="M28.5 31.5 V70.5" stroke="${BRAND.ink}" stroke-width="6.8" stroke-linecap="round"/>
    <path d="M28.5 51 H54" stroke="${BRAND.ink}" stroke-width="6" stroke-linecap="round"/>
  </g>
  <text x="82" y="212" text-anchor="middle" fill="${BRAND.ink}"
    font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="600">Trader Atlas</text>
  <text x="82" y="234" text-anchor="middle" fill="${BRAND.mute}"
    font-family="Segoe UI, Arial, sans-serif" font-size="10">交易工作台</text>
  <rect x="62" y="258" width="40" height="2" rx="1" fill="${BRAND.accent}"/>
</svg>`
}

/** 内页顶栏：150×57（NSIS MUI_HEADERIMAGE） */
function installerHeaderSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="${BRAND.bg}"/>
  <g transform="translate(10 10.5)">
    <rect width="36" height="36" rx="9" fill="#161922"/>
    <path d="M10.7 24.2 C10.7 13 25.3 11.2 25.3 11.2" fill="none" stroke="${BRAND.accent}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M10.7 11.7 V26.5" stroke="${BRAND.ink}" stroke-width="2.7" stroke-linecap="round"/>
    <path d="M10.7 19 H20.2" stroke="${BRAND.ink}" stroke-width="2.4" stroke-linecap="round"/>
  </g>
  <text x="56" y="27" fill="${BRAND.ink}"
    font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="600">Trader Atlas</text>
  <text x="56" y="43" fill="${BRAND.mute}"
    font-family="Segoe UI, Arial, sans-serif" font-size="9">安装向导</text>
</svg>`
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

  const sidebarBmp = await svgToBmp24(installerSidebarSvg(), 164, 314)
  const headerBmp = await svgToBmp24(installerHeaderSvg(), 150, 57)
  fs.writeFileSync(path.join(buildDir, 'installerSidebar.bmp'), sidebarBmp)
  fs.writeFileSync(path.join(buildDir, 'installerHeader.bmp'), headerBmp)

  console.log('Generated:')
  console.log('  build/icon.svg')
  console.log('  build/icon.png (512)')
  console.log('  build/icon.ico (16–256)')
  console.log('  build/installerSidebar.bmp (164×314, 24-bit)')
  console.log('  build/installerHeader.bmp (150×57, 24-bit)')
  console.log('  public/favicon.svg')
  console.log('  public/favicon-32.png')
  console.log('  public/apple-touch-icon.png')
  console.log('  public/icon.png (512, window)')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

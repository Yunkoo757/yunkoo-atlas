/**
 * Generate Electron / favicon / NSIS installer assets from demos/icons/atlas-icon-e.svg
 * Usage: node scripts/generate-app-icon.mjs
 *
 * NSIS 侧栏/顶栏按逻辑尺寸的 3× 出图：高 DPI 下 StretchBlt 接近 1:1 或轻度缩小，
 * 避免 164×314 被系统放大后发糊。
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
  panel: '#161922',
  accent: '#5e6ad2',
  ink: '#e8eaf6',
  mute: '#9aa3b5',
}

/** NSIS MUI 逻辑尺寸；实际 BMP 按 SCALE 输出。 */
const SIDEBAR_LOGIC = { w: 164, h: 314 }
const HEADER_LOGIC = { w: 150, h: 57 }
const NSIS_BMP_SCALE = 3

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

async function pngToBmp24(pngBuffer) {
  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return encodeBmp24(info.width, info.height, data)
}

async function buildInstallerSidebar(iconPng) {
  const w = SIDEBAR_LOGIC.w * NSIS_BMP_SCALE
  const h = SIDEBAR_LOGIC.h * NSIS_BMP_SCALE
  const mark = 96 * NSIS_BMP_SCALE
  const markTop = 78 * NSIS_BMP_SCALE
  const markLeft = Math.round((w - mark) / 2)

  const markPng = await sharp(iconPng)
    .resize(mark, mark, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer()

  const caption = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="glow" x1="${w / 2}" y1="${40 * NSIS_BMP_SCALE}" x2="${w / 2}" y2="${220 * NSIS_BMP_SCALE}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${BRAND.accent}" stop-opacity="0.2"/>
      <stop offset="1" stop-color="${BRAND.bg}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="${BRAND.bg}"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  <text x="${w / 2}" y="${212 * NSIS_BMP_SCALE}" text-anchor="middle" fill="${BRAND.ink}"
    font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="${15 * NSIS_BMP_SCALE}" font-weight="600">Trader Atlas</text>
  <text x="${w / 2}" y="${234 * NSIS_BMP_SCALE}" text-anchor="middle" fill="${BRAND.mute}"
    font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="${10 * NSIS_BMP_SCALE}">交易工作台</text>
  <rect x="${62 * NSIS_BMP_SCALE}" y="${258 * NSIS_BMP_SCALE}" width="${40 * NSIS_BMP_SCALE}" height="${2 * NSIS_BMP_SCALE}" rx="${NSIS_BMP_SCALE}" fill="${BRAND.accent}"/>
</svg>`)

  const composed = await sharp(caption)
    .composite([{ input: markPng, top: markTop, left: markLeft }])
    .png()
    .toBuffer()
  return pngToBmp24(composed)
}

async function buildInstallerHeader(iconPng) {
  const w = HEADER_LOGIC.w * NSIS_BMP_SCALE
  const h = HEADER_LOGIC.h * NSIS_BMP_SCALE
  const mark = 36 * NSIS_BMP_SCALE
  const markTop = Math.round((h - mark) / 2)
  const markLeft = 10 * NSIS_BMP_SCALE

  const markPng = await sharp(iconPng)
    .resize(mark, mark, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer()

  const caption = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${BRAND.bg}"/>
  <text x="${56 * NSIS_BMP_SCALE}" y="${27 * NSIS_BMP_SCALE}" fill="${BRAND.ink}"
    font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="${13 * NSIS_BMP_SCALE}" font-weight="600">Trader Atlas</text>
  <text x="${56 * NSIS_BMP_SCALE}" y="${43 * NSIS_BMP_SCALE}" fill="${BRAND.mute}"
    font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="${9 * NSIS_BMP_SCALE}">安装向导</text>
</svg>`)

  const composed = await sharp(caption)
    .composite([{ input: markPng, top: markTop, left: markLeft }])
    .png()
    .toBuffer()
  return pngToBmp24(composed)
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

  const sidebarBmp = await buildInstallerSidebar(png512)
  const headerBmp = await buildInstallerHeader(png512)
  fs.writeFileSync(path.join(buildDir, 'installerSidebar.bmp'), sidebarBmp)
  fs.writeFileSync(path.join(buildDir, 'installerHeader.bmp'), headerBmp)

  const sidebarW = SIDEBAR_LOGIC.w * NSIS_BMP_SCALE
  const sidebarH = SIDEBAR_LOGIC.h * NSIS_BMP_SCALE
  const headerW = HEADER_LOGIC.w * NSIS_BMP_SCALE
  const headerH = HEADER_LOGIC.h * NSIS_BMP_SCALE

  console.log('Generated:')
  console.log('  build/icon.svg')
  console.log('  build/icon.png (512)')
  console.log('  build/icon.ico (16–256)')
  console.log(`  build/installerSidebar.bmp (${sidebarW}×${sidebarH}, 24-bit, ${NSIS_BMP_SCALE}× for HiDPI)`)
  console.log(`  build/installerHeader.bmp (${headerW}×${headerH}, 24-bit, ${NSIS_BMP_SCALE}× for HiDPI)`)
  console.log('  public/favicon.svg')
  console.log('  public/favicon-32.png')
  console.log('  public/apple-touch-icon.png')
  console.log('  public/icon.png (512, window)')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

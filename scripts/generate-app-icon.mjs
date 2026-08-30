/**
 * Generate Electron / favicon / NSIS installer assets from the checked-in product icon SVG master.
 * Usage: node scripts/generate-app-icon.mjs
 *
 * NSIS 侧栏/顶栏按逻辑尺寸的 2× 出图。MUI 使用 GDI LoadImage 缩放位图，
 * 2× 在 Windows 常见 100%–200% DPI 下更接近目标控件尺寸，减少非整数下采样锯齿。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const svgPath = path.join(root, 'build/icon.svg')
const traySvgPath = path.join(root, 'build/trayTemplate.svg')
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
const NSIS_BMP_SCALE = 2

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

/**
 * Windows 标题栏会直接使用 16–24px 图层。这里不缩放 512px 母版，
 * 而是给每个小尺寸单独对齐几何边界，避免环宽、圆心与强调点落在小数像素上。
 */
function buildOpticalSmallSvg(size) {
  const geometry = {
    16: { inset: 0, radius: 4, cx: 7, cy: 9, ringRadius: 4, ringWidth: 2, dotCx: 12, dotCy: 4, dotRadius: 2 },
    20: { inset: 1, radius: 4, cx: 9, cy: 11, ringRadius: 4.5, ringWidth: 3, dotCx: 15, dotCy: 5, dotRadius: 2.5 },
    24: { inset: 1, radius: 5, cx: 11, cy: 13, ringRadius: 6.5, ringWidth: 3, dotCx: 18, dotCy: 6, dotRadius: 3 },
    32: { inset: 1, radius: 7, cx: 14, cy: 17, ringRadius: 8, ringWidth: 4, dotCx: 24, dotCy: 8, dotRadius: 4 },
  }[size]
  if (!geometry) return null
  const { inset, radius, cx, cy, ringRadius, ringWidth, dotCx, dotCy, dotRadius } = geometry
  const extent = size - inset * 2
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">
  <rect x="${inset}" y="${inset}" width="${extent}" height="${extent}" rx="${radius}" fill="#121318"/>
  <circle cx="${cx}" cy="${cy}" r="${ringRadius}" stroke="#E7E7EB" stroke-width="${ringWidth}"/>
  <circle cx="${dotCx}" cy="${dotCy}" r="${dotRadius}" fill="#737BDD"/>
</svg>`, 'utf8')
}

async function renderIconPng(svg, size) {
  const opticalSvg = buildOpticalSmallSvg(size)
  return sharp(opticalSvg ?? svg, { density: 384 }).resize(size, size).png().toBuffer()
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
  if (!fs.existsSync(svgPath)) throw new Error(`Missing selected Logo master ${svgPath}`)
  if (!fs.existsSync(traySvgPath)) throw new Error(`Missing ${traySvgPath}`)
  fs.mkdirSync(buildDir, { recursive: true })
  fs.mkdirSync(publicDir, { recursive: true })

  const svg = fs.readFileSync(svgPath)
  const png512 = await sharp(svg, { density: 384 }).resize(512, 512).png().toBuffer()
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png512)

  // Web favicon + apple touch + runtime window icon (copied into dist/)
  const png32 = await renderIconPng(svg, 32)
  const png180 = await sharp(svg, { density: 384 }).resize(180, 180).png().toBuffer()
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), svg)
  fs.writeFileSync(path.join(publicDir, 'favicon-32.png'), png32)
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), png180)
  fs.writeFileSync(path.join(publicDir, 'icon.png'), png512)

  const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
  const icoPngs = []
  for (const size of icoSizes) {
    icoPngs.push(await renderIconPng(svg, size))
  }
  const ico = pngsToIco(icoPngs)
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico)
  fs.writeFileSync(path.join(publicDir, 'icon.ico'), ico)

  const sidebarBmp = await buildInstallerSidebar(png512)
  const headerBmp = await buildInstallerHeader(png512)
  fs.writeFileSync(path.join(buildDir, 'installerSidebar.bmp'), sidebarBmp)
  fs.writeFileSync(path.join(buildDir, 'installerHeader.bmp'), headerBmp)

  const traySvg = fs.readFileSync(traySvgPath)
  const tray1x = await sharp(traySvg, { density: 384 }).resize(18, 18).png().toBuffer()
  const tray2x = await sharp(traySvg, { density: 384 }).resize(36, 36).png().toBuffer()
  fs.writeFileSync(path.join(buildDir, 'trayTemplate.png'), tray1x)
  fs.writeFileSync(path.join(buildDir, 'trayTemplate@2x.png'), tray2x)

  const sidebarW = SIDEBAR_LOGIC.w * NSIS_BMP_SCALE
  const sidebarH = SIDEBAR_LOGIC.h * NSIS_BMP_SCALE
  const headerW = HEADER_LOGIC.w * NSIS_BMP_SCALE
  const headerH = HEADER_LOGIC.h * NSIS_BMP_SCALE

  console.log('Generated:')
  console.log('  build/icon.svg')
  console.log('  build/icon.png (512)')
  console.log('  build/icon.ico (16/20/24/32/40/48/64/128/256)')
  console.log(`  build/installerSidebar.bmp (${sidebarW}×${sidebarH}, 24-bit, ${NSIS_BMP_SCALE}× for HiDPI)`)
  console.log(`  build/installerHeader.bmp (${headerW}×${headerH}, 24-bit, ${NSIS_BMP_SCALE}× for HiDPI)`)
  console.log('  build/trayTemplate.png (18, monochrome template)')
  console.log('  build/trayTemplate@2x.png (36, monochrome template)')
  console.log('  public/favicon.svg')
  console.log('  public/favicon-32.png')
  console.log('  public/apple-touch-icon.png')
  console.log('  public/icon.ico (Windows window icon)')
  console.log('  public/icon.png (512, window)')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

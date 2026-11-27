import path from 'node:path'

const textExtensions = new Set([
  '.md', '.markdown', '.mdx', '.txt', '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc', '.yml', '.yaml', '.toml',
  '.css', '.scss', '.sass', '.less', '.html', '.htm', '.svg', '.xml', '.csv',
  '.sh', '.bash', '.zsh', '.ps1', '.ini', '.cfg', '.conf',
  '.py', '.sql', '.nsh', '.nsi', '.bat', '.cmd', '.lock',
])
const textNames = new Set([
  '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc',
  'license', '.prettierignore', '.eslintignore', 'pre-commit', 'pre-push', 'commit-msg',
])
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

// Git -z emits path bytes. A leading U+FEFF is part of the first name.
export function decodeGitPaths(bytes) {
  return decoder.decode(bytes).split('\0').filter(Boolean)
}

export function isKnownTextPath(file) {
  const name = path.posix.basename(file).toLowerCase()
  return textNames.has(name) || textExtensions.has(path.posix.extname(name))
}

/** 全仓扫描也检查没有登记扩展名的文本。未知格式沿用前 8192 字节的二进制判定。 */
export function isRepositoryText(file, bytes) {
  const utf16Bom = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)
  return isKnownTextPath(file) || utf16Bom || !bytes.subarray(0, 8192).includes(0)
}

export function decodeRepositoryText(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error('带有 UTF-8 BOM')
  if (bytes.includes(0)) throw new Error('含有 NUL 字节，请检查文件是否使用了 UTF-16')
  try {
    return decoder.decode(bytes)
  } catch {
    throw new Error('不是有效 UTF-8')
  }
}

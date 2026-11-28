import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'

/** Keep generated SSR modules under the repository's ignored results tree for Node package resolution. */
export async function withQaBuildDirectory(root, work) {
  const results = path.join(root, 'test-results')
  await mkdir(results, { recursive: true })
  const directory = await mkdtemp(path.join(results, '.qa-build-'))
  try {
    return await work(directory)
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 })
  }
}

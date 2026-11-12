// QA-only helper. Use only with the current task's explicit isolated runtime/library paths.
export async function armNativeImportCopyFailureOnce(electronApp, isolationRoot, libraryRoot) {
  return electronApp.evaluate((_electron, input) => {
    const fs = process.getBuiltinModule('fs')
    const path = process.getBuiltinModule('path')
    const os = process.getBuiltinModule('os')
    const runtime = fs.realpathSync(input.isolationRoot)
    const library = fs.realpathSync(input.libraryRoot)
    const relative = path.relative(runtime, library)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('The library must be inside this isolated QA runtime')
    const existing = globalThis.__ATLAS_NATIVE_IMPORT_COPY_FAULT__
    if (existing?.armed) throw new Error('A native import fault is already armed')
    const original = fs.copyFileSync
    const temporaryRoot = fs.realpathSync(os.tmpdir())
    const activeAttachments = path.join(library, 'attachments')
    const state = { armed: true, hits: 0, partialMutationReached: false, source: null, destination: null }
    function restore() {
      fs.copyFileSync = original
      state.armed = false
    }
    function injected(source, destination, mode) {
      const sourceFile = path.resolve(String(source))
      const destinationFile = path.resolve(String(destination))
      const sourceParent = fs.realpathSync(path.dirname(sourceFile))
      const destinationParent = fs.realpathSync(path.dirname(destinationFile))
      const stagedParts = path.relative(temporaryRoot, sourceParent).split(path.sep)
      const privatePreparedSource = stagedParts.length === 3
        && stagedParts[0].startsWith('trader-atlas-journal-import-')
        && stagedParts[1] === 'library' && stagedParts[2] === 'attachments'
      if (state.armed && privatePreparedSource && destinationParent === activeAttachments) {
        // Restore before throwing so the recovery copy is never faulted a second time.
        restore()
        state.hits += 1
        state.source = sourceFile
        state.destination = destinationFile
        const candidateDb = path.join(path.dirname(sourceParent), 'journal.db')
        state.partialMutationReached = fs.existsSync(path.join(library, '.journal-import.json'))
          && fs.readdirSync(activeAttachments).length === 0
          && fs.readFileSync(path.join(library, 'journal.db')).equals(fs.readFileSync(candidateDb))
        const error = new Error('Isolated QA one-shot native import attachment copy failure')
        error.code = 'EIO'
        throw error
      }
      return original(source, destination, mode)
    }
    fs.copyFileSync = injected
    Object.defineProperty(globalThis, '__ATLAS_NATIVE_IMPORT_COPY_FAULT__', {
      configurable: true, enumerable: false, value: { state, restore },
    })
    return { armed: state.armed, library }
  }, { isolationRoot, libraryRoot })
}

export async function nativeImportCopyFaultState(electronApp) {
  return electronApp.evaluate(() => globalThis.__ATLAS_NATIVE_IMPORT_COPY_FAULT__?.state ?? null)
}

export async function restoreNativeImportCopyFault(electronApp) {
  return electronApp.evaluate(() => {
    const fault = globalThis.__ATLAS_NATIVE_IMPORT_COPY_FAULT__
    fault?.restore()
    return fault?.state ?? null
  })
}

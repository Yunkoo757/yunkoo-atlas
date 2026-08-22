import { validateBundleBuildIdentityEvidence } from './bundle-build-identity.mjs'

async function runVerifiedElectronEvidence(dependencies, requiredBundles, label) {
  let primaryError
  let capturedEvidence
  try {
    const bundleIdentity = await dependencies.readBundleIdentity()
    validateBundleBuildIdentityEvidence(bundleIdentity, requiredBundles)
    const library = await dependencies.createLibrary(bundleIdentity)
    const seed = await dependencies.seedLibrary({ bundleIdentity, library })
    capturedEvidence = await dependencies.captureEvidence({ bundleIdentity, library, seed })
  } catch (error) {
    primaryError = error
  }

  let cleanupError
  try {
    await dependencies.cleanupEvidence()
  } catch (error) {
    cleanupError = error
  }

  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      `${label} failed and cleanup also failed`,
    )
  }
  if (primaryError) throw primaryError
  if (cleanupError) throw cleanupError
  return dependencies.writeReport(capturedEvidence)
}

export function runElectronVisualEvidenceRunner(dependencies) {
  return runVerifiedElectronEvidence(dependencies, ['renderer', 'main'], 'Electron visual evidence')
}

export function runForcedKillEvidenceRunner(dependencies) {
  return runVerifiedElectronEvidence(dependencies, ['main'], 'Forced-kill evidence')
}

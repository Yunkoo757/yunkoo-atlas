export function releaseQaCommands(mode) {
  if (mode !== 'full' && mode !== 'smoke') throw new Error(`Unknown release QA mode: ${mode}`)
  return [
    'qa:ci',
    mode === 'full' ? 'qa' : 'qa:core',
    'build:app',
    'test:storage-recovery:electron',
    ...(mode === 'full' ? ['qa:dashboard-10k'] : []),
    'qa:electron',
  ]
}

export function fullQaPassed(report) {
  if (report?.version !== 1 || report.mode !== 'full' || report.status !== 'pass') return false
  const expected = releaseQaCommands('full')
  return Array.isArray(report.commands) && report.commands.length === expected.length &&
    expected.every((command, index) => report.commands[index] === command)
}

import { emptyJudgmentDesk, type JudgmentDeskData } from './model'
export function remapJudgmentAssets(data: JudgmentDeskData | undefined, ids: ReadonlyMap<string, string>): JudgmentDeskData {
  const original = data ?? emptyJudgmentDesk()
  return { ...original, samples: original.samples.map(s => ({ ...s, images: s.images.map(i => {
    const assetId = ids.get(i.assetId)
    if (!assetId) throw new Error('判断素材缺少图片附件')
    return { ...i, assetId }
  }) })) }
}
export function mergeJudgmentDesk(current: JudgmentDeskData | undefined, imported: JudgmentDeskData | undefined, importedId: (id: string) => string): JudgmentDeskData {
  const local = current ?? emptyJudgmentDesk(), incoming = imported ?? emptyJudgmentDesk()
  // Import namespaces preserve both sets of conclusions; stable IDs make repeat imports idempotent.
  const merge = <T extends { id: string }>(a: T[], b: T[]) => [...a, ...b.filter(v => !a.some(x => x.id === v.id))]
  return { ...local,
    themes: merge(local.themes, incoming.themes.map(t => ({ ...t, id: importedId(t.id) }))),
    samples: merge(local.samples, incoming.samples.map(s => ({ ...s, id: importedId(s.id), themeId: importedId(s.themeId) }))),
    attempts: merge(local.attempts, incoming.attempts.map(a => ({ ...a, id: importedId(a.id), sampleId: importedId(a.sampleId) }))),
  }
}

import {
  parseImportJson,
  serializeJsonExportPayload,
} from '@/lib/importExport'

export function exerciseJsonProductionPath(payload: unknown): {
  json: string
  importOk: boolean
  importCode: string | null
} {
  const json = serializeJsonExportPayload(payload)
  const parsed = parseImportJson(json)
  return {
    json,
    importOk: parsed.ok,
    importCode: parsed.ok ? null : parsed.code,
  }
}

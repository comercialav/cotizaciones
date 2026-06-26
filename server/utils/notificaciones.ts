import type { NotificacionesConfig } from '~/utils/notificaciones'
import { mergeNotificacionesConfig } from '~/utils/notificaciones'

const CACHE_TTL_MS = 30_000
let cache: { config: NotificacionesConfig; ts: number } | null = null

function parseFirestoreValue(value: any): any {
  if (!value || typeof value !== 'object') return undefined
  if ('booleanValue' in value) return value.booleanValue
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('mapValue' in value) {
    const out: Record<string, any> = {}
    const fields = value.mapValue?.fields || {}
    for (const [key, nested] of Object.entries(fields)) {
      out[key] = parseFirestoreValue(nested)
    }
    return out
  }
  return undefined
}

function parseFirestoreDocument(doc: any): Partial<NotificacionesConfig> | null {
  const fields = doc?.fields
  if (!fields) return null
  return {
    emailEnabled: parseFirestoreValue(fields.emailEnabled),
    slackEnabled: parseFirestoreValue(fields.slackEnabled),
    events: parseFirestoreValue(fields.events),
  }
}

export async function getNotificacionesConfig(): Promise<NotificacionesConfig> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.config
  }

  const config = useRuntimeConfig()
  const projectId = config.firebaseProjectId || config.public.firebaseProjectId
  const apiKey = config.firebaseApiKey || config.public.firebaseApiKey

  if (!projectId) {
    return mergeNotificacionesConfig(null)
  }

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/config/notificaciones`

  try {
    const doc = await $fetch<any>(url, {
      query: apiKey ? { key: apiKey } : undefined,
    })
    const parsed = mergeNotificacionesConfig(parseFirestoreDocument(doc))
    cache = { config: parsed, ts: Date.now() }
    return parsed
  } catch {
    return mergeNotificacionesConfig(null)
  }
}

export function invalidateNotificacionesCache() {
  cache = null
}

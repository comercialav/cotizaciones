// server/utils/slack.ts
// Lógica reutilizable para enviar mensajes directos de Slack por email.

const SLACK_BASE = 'https://slack.com/api'

export type SlackDMResult = {
  ok: boolean
  channel?: string
  userId?: string
  error?: string
}

function slackHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

/**
 * Envía un DM de Slack al usuario cuyo email coincide con `toEmail`.
 * Devuelve un resultado estructurado en vez de lanzar, para poder reportar
 * errores legibles (p.ej. en el panel de pruebas) sin tumbar la petición.
 */
export async function sendSlackDM(opts: {
  toEmail: string
  text: string
  blocks?: any[]
}): Promise<SlackDMResult> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return { ok: false, error: 'Falta SLACK_BOT_TOKEN en el servidor' }
  if (!opts.toEmail) return { ok: false, error: 'Falta el email de destino' }
  if (!opts.text) return { ok: false, error: 'Falta el texto del mensaje' }

  const headers = slackHeaders(token)

  try {
    const userData = await $fetch<any>(`${SLACK_BASE}/users.lookupByEmail`, {
      method: 'GET',
      headers,
      query: { email: opts.toEmail },
    })
    if (!userData?.ok) {
      return { ok: false, error: `lookupByEmail: ${userData?.error || 'desconocido'}` }
    }
    const userId = userData.user.id as string

    const openData = await $fetch<any>(`${SLACK_BASE}/conversations.open`, {
      method: 'POST',
      headers,
      body: { users: userId },
    })
    if (!openData?.ok) {
      return { ok: false, userId, error: `conversations.open: ${openData?.error || 'desconocido'}` }
    }
    const channel = openData.channel.id as string

    const postData = await $fetch<any>(`${SLACK_BASE}/chat.postMessage`, {
      method: 'POST',
      headers,
      body: { channel, text: opts.text, blocks: opts.blocks },
    })
    if (!postData?.ok) {
      return { ok: false, userId, channel, error: `chat.postMessage: ${postData?.error || 'desconocido'}` }
    }

    return { ok: true, userId, channel }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error inesperado al enviar a Slack' }
  }
}

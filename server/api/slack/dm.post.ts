// server/api/slack/dm.post.ts
import { getNotificacionesConfig } from '~/server/utils/notificaciones'
import { sendSlackDM } from '~/server/utils/slack'
import { canSendSlack } from '~/utils/notificaciones'

export default defineEventHandler(async (event) => {
  const { toEmail, text, ccEmail, blocks, event: eventKey } = await readBody(event)
  if (!toEmail || !text) {
    throw createError({ statusCode: 400, statusMessage: 'toEmail y text son obligatorios' })
  }

  const notifCfg = await getNotificacionesConfig()
  const slackEvent = String(eventKey || '').trim()
  if (slackEvent && !canSendSlack(notifCfg, slackEvent)) {
    return { ok: true, skipped: true, reason: 'slack_disabled', event: slackEvent }
  }
  if (!notifCfg.slackEnabled) {
    return { ok: true, skipped: true, reason: 'slack_disabled_global' }
  }

  const result = await sendSlackDM({ toEmail, text, blocks })
  if (!result.ok) {
    throw createError({ statusCode: 502, statusMessage: `Slack: ${result.error}` })
  }

  // CC opcional (no bloquea ni falla la petición principal)
  if (ccEmail) {
    const cc = await sendSlackDM({ toEmail: ccEmail, text, blocks })
    if (!cc.ok) console.error('CC Slack falló:', cc.error)
  }

  return { ok: true }
})

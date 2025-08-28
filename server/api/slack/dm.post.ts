// server/api/slack/dm.post.ts
export default defineEventHandler(async (event) => {
  const { toEmail, text, ccEmail, blocks } = await readBody(event)
  if (!toEmail || !text) {
    throw createError({ statusCode: 400, statusMessage: "toEmail y text son obligatorios" })
  }

  const token = process.env.SLACK_BOT_TOKEN
  if (!token) throw createError({ statusCode: 500, statusMessage: "Falta SLACK_BOT_TOKEN" })

  const base = "https://slack.com/api"
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }

  // 1) Buscar userId por email
  const userData = await $fetch(`${base}/users.lookupByEmail`, {
    method: "GET",
    headers,
    query: { email: toEmail }
  })
  if (!userData.ok) {
    // p.ej. users_not_found
    throw createError({ statusCode: 404, statusMessage: `Slack: ${userData.error}` })
  }
  const userId = userData.user.id as string

  // 2) Abrir (o recuperar) el DM
  const openData = await $fetch(`${base}/conversations.open`, {
    method: "POST",
    headers,
    body: { users: userId }
  })
  if (!openData.ok) {
    throw createError({ statusCode: 500, statusMessage: `Slack: ${openData.error}` })
  }
  const channel = (openData as any).channel.id as string

  // 3) Enviar mensaje
  const postData = await $fetch(`${base}/chat.postMessage`, {
    method: "POST",
    headers,
    body: { channel, text, blocks }
  })
  if (!postData.ok) {
    throw createError({ statusCode: 500, statusMessage: `Slack: ${postData.error}` })
  }

  // CC opcional
  if (ccEmail) {
    try {
      const ccUser = await $fetch(`${base}/users.lookupByEmail`, {
        method: "GET", headers, query: { email: ccEmail }
      })
      if (ccUser.ok) {
        const ccId = (ccUser as any).user.id
        const ccOpen = await $fetch(`${base}/conversations.open`, {
          method: "POST", headers, body: { users: ccId }
        })
        if ((ccOpen as any).ok) {
          await $fetch(`${base}/chat.postMessage`, {
            method: "POST", headers,
            body: { channel: (ccOpen as any).channel.id, text, blocks }
          })
        }
      }
    } catch (e) {
      console.error("CC Slack falló:", e)
    }
  }

  return { ok: true }
})

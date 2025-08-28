// server/api/slack/avatar.ts
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const email = String(query.email || "")
  const username = String(query.username || "")
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return { ok:false, message:"Missing SLACK_BOT_TOKEN" }
  try {
    let url: string | null = null

    if (email) {
      const r = await $fetch("https://slack.com/api/users.lookupByEmail", {
        headers: { Authorization: `Bearer ${token}` },
        query: { email }
      }) as any
      if (r?.ok) url = r.user?.profile?.image_72 || r.user?.profile?.image_48
    }

    if (!url && username) {
      const r = await $fetch("https://slack.com/api/users.list", {
        headers: { Authorization: `Bearer ${token}` }
      }) as any
      const u = r?.members?.find((m:any) =>
        m?.name?.toLowerCase?.() === username.toLowerCase()
      )
      url = u?.profile?.image_72 || u?.profile?.image_48 || null
    }

    return { ok: Boolean(url), url }
  } catch (e:any) {
    return sendError(event, createError({ statusCode:500, statusMessage:e?.message || "Slack error" }))
  }
})

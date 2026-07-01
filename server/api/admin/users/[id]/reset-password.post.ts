import { getAdminAuth, getAdminFirestore } from '~/server/utils/firebase-admin'
import { requireAdmin } from '~/server/utils/admin-auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta id de usuario' })

  const snap = await getAdminFirestore().collection('usuarios').doc(id).get()
  if (!snap.exists) {
    throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })
  }

  const data = snap.data() || {}
  const email = String(data.email || '').trim().toLowerCase()
  if (!email) {
    throw createError({ statusCode: 400, statusMessage: 'El usuario no tiene email' })
  }

  try {
    const resetLink = await getAdminAuth().generatePasswordResetLink(email)
    return {
      ok: true,
      resetLink,
      message: 'Enlace generado. Compártelo con el usuario para que establezca o cambie su contraseña.',
    }
  } catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: e?.message || 'No se pudo generar el enlace' })
  }
})

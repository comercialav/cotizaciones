import { FieldValue } from 'firebase-admin/firestore'
import { getAdminAuth, getAdminFirestore } from '~/server/utils/firebase-admin'
import { requireAdmin, serializeUserDoc } from '~/server/utils/admin-auth'

const ALLOWED_ROLES = ['comercial', 'compras', 'jefe_comercial', 'admin'] as const

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta id de usuario' })

  const body = await readBody<any>(event).catch(() => ({}))
  const db = getAdminFirestore()
  const auth = getAdminAuth()
  const ref = db.collection('usuarios').doc(id)
  const snap = await ref.get()

  if (!snap.exists) {
    throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })
  }

  const current = snap.data() || {}
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

  if (typeof body?.nombre === 'string' && body.nombre.trim()) {
    patch.nombre = body.nombre.trim()
  }

  if (typeof body?.rol === 'string') {
    const rol = body.rol.toLowerCase()
    if (!ALLOWED_ROLES.includes(rol as typeof ALLOWED_ROLES[number])) {
      throw createError({ statusCode: 400, statusMessage: 'Rol no válido' })
    }
    patch.rol = rol
    patch.esSupervisor = rol === 'jefe_comercial' || rol === 'admin'
  }

  if (typeof body?.activo === 'boolean') {
    patch.activo = body.activo
    const authUid = String(current.authUid || id)
    try {
      await auth.updateUser(authUid, { disabled: !body.activo })
    } catch (e: any) {
      console.error('[admin/users] updateUser disabled:', e?.message)
    }
  }

  await ref.set(patch, { merge: true })
  const updated = await ref.get()
  return { ok: true, user: serializeUserDoc(updated.id, updated.data() || {}) }
})

import { getAdminAuth, getAdminFirestore } from '~/server/utils/firebase-admin'
import { requireAdmin, serializeUserDoc } from '~/server/utils/admin-auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const snap = await getAdminFirestore().collection('usuarios').get()

  const users = snap.docs
    .map((doc) => serializeUserDoc(doc.id, doc.data()))
    .sort((a, b) => (a.nombre || a.email).localeCompare(b.nombre || b.email, 'es'))
  return { ok: true, users }
})

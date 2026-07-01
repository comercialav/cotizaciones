import { getStorage } from 'firebase-admin/storage'
import { getAdminApp, getAdminFirestore } from '~/server/utils/firebase-admin'
import { requireComprasOrSupervisor } from '~/server/utils/admin-auth'

async function deleteCollection(
  db: FirebaseFirestore.Firestore,
  ref: FirebaseFirestore.CollectionReference,
  batchSize = 100,
): Promise<number> {
  const snap = await ref.limit(batchSize).get()
  if (snap.empty) return 0

  const batch = db.batch()
  snap.docs.forEach((d) => batch.delete(d.ref))
  await batch.commit()

  return snap.size + (snap.size === batchSize ? await deleteCollection(db, ref, batchSize) : 0)
}

async function deleteStoragePrefix(prefix: string) {
  try {
    const bucket = getStorage(getAdminApp()).bucket()
    const [files] = await bucket.getFiles({ prefix })
    await Promise.all(files.map((f) => f.delete().catch(() => {})))
  } catch (e) {
    console.warn('[cotizaciones/delete] Storage cleanup:', e)
  }
}

export default defineEventHandler(async (event) => {
  await requireComprasOrSupervisor(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta id de cotización' })

  const db = getAdminFirestore()
  const ref = db.collection('cotizaciones').doc(id)
  const snap = await ref.get()

  if (!snap.exists) {
    throw createError({ statusCode: 404, statusMessage: 'Cotización no encontrada' })
  }

  const data = snap.data() || {}
  const numero = String(data.numero || id)

  for (const sub of ['comentarios', 'adjuntos']) {
    await deleteCollection(db, ref.collection(sub))
  }

  await deleteStoragePrefix(`cotizaciones/${id}/`)
  await ref.delete()

  return { ok: true, id, numero }
})

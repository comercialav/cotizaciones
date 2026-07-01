import { FieldValue } from 'firebase-admin/firestore'
import { getAdminAuth, getAdminFirestore } from '~/server/utils/firebase-admin'
import { requireAdmin, serializeUserDoc } from '~/server/utils/admin-auth'

const ALLOWED_ROLES = ['comercial', 'compras', 'jefe_comercial', 'admin'] as const

function randomPassword(length = 20) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  let out = ''
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readBody<any>(event).catch(() => ({}))

  const email = String(body?.email || '').trim().toLowerCase()
  const nombre = String(body?.nombre || '').trim()
  const rol = String(body?.rol || 'comercial').toLowerCase()

  if (!email || !email.includes('@')) {
    throw createError({ statusCode: 400, statusMessage: 'Email inválido' })
  }
  if (!nombre) {
    throw createError({ statusCode: 400, statusMessage: 'El nombre es obligatorio' })
  }
  if (!ALLOWED_ROLES.includes(rol as typeof ALLOWED_ROLES[number])) {
    throw createError({ statusCode: 400, statusMessage: 'Rol no válido' })
  }

  const auth = getAdminAuth()
  const db = getAdminFirestore()

  const existing = await db.collection('usuarios').where('emailLower', '==', email).limit(1).get()
  if (!existing.empty) {
    throw createError({ statusCode: 409, statusMessage: 'Ya existe un usuario con ese email' })
  }

  let authUser
  try {
    authUser = await auth.createUser({
      email,
      password: randomPassword(),
      displayName: nombre,
      disabled: false,
    })
  } catch (e: any) {
    if (e?.code === 'auth/email-already-exists') {
      authUser = await auth.getUserByEmail(email)
    } else {
      throw createError({ statusCode: 500, statusMessage: e?.message || 'No se pudo crear en Firebase Auth' })
    }
  }

  const docRef = db.collection('usuarios').doc(authUser.uid)
  await docRef.set({
    authUid: authUser.uid,
    email,
    emailLower: email,
    nombre,
    rol,
    activo: true,
    esSupervisor: rol === 'jefe_comercial' || rol === 'admin',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: {
      uid: admin.uid,
      email: admin.email,
    },
  }, { merge: true })

  let resetLink: string | null = null
  try {
    resetLink = await auth.generatePasswordResetLink(email)
  } catch (e: any) {
    console.error('[admin/users] generatePasswordResetLink:', e?.message)
  }

  const saved = await docRef.get()
  return {
    ok: true,
    user: serializeUserDoc(saved.id, saved.data() || {}),
    resetLink,
    message: resetLink
      ? 'Usuario creado. Envía el enlace de restablecimiento para que elija su contraseña.'
      : 'Usuario creado. Usa «Enviar enlace de contraseña» si hace falta.',
  }
})

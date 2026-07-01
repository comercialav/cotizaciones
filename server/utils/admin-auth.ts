import type { H3Event } from 'h3'
import { getAdminAuth, getAdminFirestore } from '~/server/utils/firebase-admin'

export type AdminContext = {
  uid: string
  email: string
  profile: FirebaseFirestore.DocumentData | null
  profileId: string | null
}

function isAdminRole(profile: FirebaseFirestore.DocumentData | null, email: string): boolean {
  const rol = String(profile?.rol || '').toLowerCase()
  if (rol === 'admin') return true

  const admins = String(process.env.ADMIN_EMAILS || 'samuel@comercialav.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return admins.includes(email.toLowerCase())
}

export async function findProfileByEmail(email: string) {
  const db = getAdminFirestore()
  const emailLower = email.toLowerCase()

  let snap = await db.collection('usuarios').where('emailLower', '==', emailLower).limit(1).get()
  if (snap.empty) {
    snap = await db.collection('usuarios').where('email', '==', email).limit(1).get()
  }
  if (snap.empty) return { id: null, data: null }

  const doc = snap.docs[0]
  return { id: doc.id, data: doc.data() }
}

export function canBorrarCotizacion(
  profile: FirebaseFirestore.DocumentData | null,
  email: string,
): boolean {
  const rol = String(profile?.rol || '').toLowerCase()
  const mail = email.toLowerCase()

  if (rol === 'compras' || mail === 'compras@comercialav.com') return true
  if (rol === 'jefe_comercial' || rol === 'admin') return true
  if (rol.includes('vanes')) return true
  if (profile?.esSupervisor === true) return true

  return false
}

export async function requireComprasOrSupervisor(event: H3Event): Promise<AdminContext> {
  const authHeader = getHeader(event, 'authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Sesión requerida' })
  }

  let decoded
  try {
    decoded = await getAdminAuth().verifyIdToken(token)
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Token inválido o caducado' })
  }

  const email = decoded.email || ''
  if (!email) {
    throw createError({ statusCode: 401, statusMessage: 'El usuario no tiene email' })
  }

  const { id, data } = await findProfileByEmail(email)
  if (!canBorrarCotizacion(data, email)) {
    throw createError({ statusCode: 403, statusMessage: 'No tienes permisos para borrar cotizaciones' })
  }

  return {
    uid: decoded.uid,
    email,
    profile: data,
    profileId: id,
  }
}

export async function requireAdmin(event: H3Event): Promise<AdminContext> {
  const authHeader = getHeader(event, 'authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Sesión requerida' })
  }

  let decoded
  try {
    decoded = await getAdminAuth().verifyIdToken(token)
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Token inválido o caducado' })
  }

  const email = decoded.email || ''
  if (!email) {
    throw createError({ statusCode: 401, statusMessage: 'El usuario no tiene email' })
  }

  const { id, data } = await findProfileByEmail(email)
  if (!isAdminRole(data, email)) {
    throw createError({ statusCode: 403, statusMessage: 'No tienes permisos de administración' })
  }

  return {
    uid: decoded.uid,
    email,
    profile: data,
    profileId: id,
  }
}

export function serializeUserDoc(id: string, data: FirebaseFirestore.DocumentData) {
  return {
    id,
    authUid: data.authUid || id,
    email: data.email || '',
    nombre: data.nombre || '',
    rol: data.rol || 'comercial',
    activo: data.activo !== false,
    esSupervisor: data.esSupervisor === true,
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null,
  }
}

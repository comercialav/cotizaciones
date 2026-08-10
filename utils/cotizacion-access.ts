import {
  collection, getDocs, limit, orderBy, query, where,
  type Firestore,
} from 'firebase/firestore'

export type CotizacionParticipante = {
  uid: string
  nombre: string | null
  email: string | null
  rol?: string | null
  addedAt?: unknown
  addedBy?: { uid: string; nombre: string | null }
}

export function getCotizacionMs(c: any): number {
  const ts = c?.fechaCreacion || c?.updatedAt || c?.createdAt
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.toDate === 'function') return ts.toDate().getTime()
  const d = new Date(ts)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

export function participantesOf(cot: any): CotizacionParticipante[] {
  return Array.isArray(cot?.participantes) ? cot.participantes : []
}

export function buildParticipanteUids(
  vendedorUid: string | null | undefined,
  participantes: CotizacionParticipante[],
): string[] {
  const uids = new Set<string>()
  if (vendedorUid) uids.add(String(vendedorUid))
  for (const p of participantes) {
    if (p?.uid) uids.add(String(p.uid))
  }
  return [...uids]
}

/** Emails de participantes (no vendedor), en minúsculas para consultas */
export function buildParticipanteEmails(participantes: CotizacionParticipante[]): string[] {
  const emails = new Set<string>()
  for (const p of participantes) {
    const mail = String(p.email || '').trim().toLowerCase()
    if (mail.includes('@')) emails.add(mail)
  }
  return [...emails]
}

export function participanteEmailsOf(cot: any): string[] {
  if (Array.isArray(cot?.participanteEmails) && cot.participanteEmails.length) {
    return cot.participanteEmails.map((e: unknown) => String(e).trim().toLowerCase()).filter(e => e.includes('@'))
  }
  return buildParticipanteEmails(participantesOf(cot))
}

export function participanteUidsOf(cot: any): string[] {
  if (Array.isArray(cot?.participanteUids) && cot.participanteUids.length) {
    return cot.participanteUids.map(String).filter(Boolean)
  }
  const uid = cot?.vendedor?.uid || cot?.vendedorUid
  return uid ? [String(uid)] : []
}

export function isCotizacionOwner(
  userUid: string | null | undefined,
  cot: any,
  userEmail?: string | null,
): boolean {
  if (!cot) return false
  if (userUid && userUid === (cot.vendedor?.uid || cot.vendedorUid)) return true
  const mail = String(userEmail || '').trim().toLowerCase()
  const vendMail = String(cot.vendedor?.email || '').trim().toLowerCase()
  return !!(mail && vendMail && mail === vendMail)
}

export function isCotizacionParticipant(
  userUid: string | null | undefined,
  cot: any,
  userEmail?: string | null,
): boolean {
  if (!cot) return false
  if (isCotizacionOwner(userUid, cot, userEmail)) return true

  const mail = String(userEmail || '').trim().toLowerCase()
  if (mail) {
    if (participanteEmailsOf(cot).includes(mail)) return true
    if (participantesOf(cot).some(p => String(p.email || '').trim().toLowerCase() === mail)) return true
  }

  if (!userUid) return false
  const uid = String(userUid)
  if (participanteUidsOf(cot).includes(uid)) return true
  return participantesOf(cot).some(p => String(p.uid) === uid)
}

export function puedeActuarComercialEnCotizacion(
  user: { uid?: string | null; email?: string | null; scopeUids?: string[] | null },
  cot: any,
): boolean {
  if (!cot) return false
  const scopeUids = user.scopeUids?.length
    ? user.scopeUids
    : (user.uid ? [user.uid] : [])
  for (const uid of scopeUids) {
    if (isCotizacionParticipant(uid, cot, user.email)) return true
  }
  return isCotizacionOwner(null, cot, user.email)
}

export function canViewCotizacion(user: any, cot: any): boolean {
  if (!cot) return false
  if (user?.isSupervisor || user?.isCompras) return true
  const scopeUids: string[] = user?.scopeUids?.length
    ? user.scopeUids
    : (user?.uid ? [user.uid] : [])
  for (const uid of scopeUids) {
    if (isCotizacionParticipant(uid, cot, user?.email)) return true
  }
  return isCotizacionOwner(null, cot, user?.email)
}

export function cotizacionComercialEmails(cot: any): string[] {
  const emails = new Set<string>()
  const vendedorEmail = String(cot?.vendedor?.email || '').trim()
  if (vendedorEmail.includes('@')) emails.add(vendedorEmail)
  for (const p of participantesOf(cot)) {
    const e = String(p.email || '').trim()
    if (e.includes('@')) emails.add(e)
  }
  return [...emails]
}

export function mergeCotizacionesById(...lists: any[][]): any[] {
  const map = new Map<string, any>()
  for (const list of lists) {
    for (const c of list) {
      if (c?.id && !map.has(c.id)) map.set(c.id, c)
    }
  }
  return [...map.values()].sort((a, b) => getCotizacionMs(b) - getCotizacionMs(a))
}

async function safeCotizacionQuery(
  label: string,
  run: () => Promise<{ docs: Array<{ id: string; data: () => any }> }>,
): Promise<any[]> {
  try {
    const snap = await run()
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) {
    console.warn(`[cotizaciones] query ${label} failed:`, e)
    return []
  }
}

/** Consulta con fallback sin orderBy si falla el índice compuesto */
async function queryWithFallback(
  label: string,
  withOrder: () => Promise<{ docs: Array<{ id: string; data: () => any }> }>,
  withoutOrder: () => Promise<{ docs: Array<{ id: string; data: () => any }> }>,
): Promise<any[]> {
  const primary = await safeCotizacionQuery(label, withOrder)
  if (primary.length) return primary
  return safeCotizacionQuery(`${label}:fallback`, withoutOrder)
}

export async function fetchCotizacionesForScope(
  db: Firestore,
  opts: {
    isSupervisor: boolean
    scopeUids?: string[]
    userEmail?: string | null
    selectedComercialUid?: string | null
    selectedComercialEmail?: string | null
    max?: number
  },
): Promise<any[]> {
  const max = opts.max ?? 500
  const col = collection(db, 'cotizaciones')
  const order = orderBy('updatedAt', 'desc')
  const lim = limit(max)

  if (opts.isSupervisor && !opts.selectedComercialUid) {
    const snap = await getDocs(query(col, order, lim))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  }

  const uids = [...new Set(
    (opts.isSupervisor
      ? [opts.selectedComercialUid]
      : (opts.scopeUids || [])
    ).filter(Boolean).map(String),
  )]

  const email = String(
    opts.isSupervisor ? opts.selectedComercialEmail : opts.userEmail,
  ).trim()

  const lists: any[][] = []

  for (const uid of uids) {
    lists.push(await queryWithFallback(
      `vendedor.uid=${uid}`,
      () => getDocs(query(col, where('vendedor.uid', '==', uid), order, lim)),
      () => getDocs(query(col, where('vendedor.uid', '==', uid), lim)),
    ))
    lists.push(await queryWithFallback(
      `participanteUids=${uid}`,
      () => getDocs(query(col, where('participanteUids', 'array-contains', uid), order, lim)),
      () => getDocs(query(col, where('participanteUids', 'array-contains', uid), lim)),
    ))
  }

  if (email.includes('@')) {
    const lower = email.toLowerCase()
    lists.push(await queryWithFallback(
      `vendedor.email=${lower}`,
      () => getDocs(query(col, where('vendedor.email', '==', lower), order, lim)),
      () => getDocs(query(col, where('vendedor.email', '==', lower), lim)),
    ))
    lists.push(await queryWithFallback(
      `participanteEmails=${lower}`,
      () => getDocs(query(col, where('participanteEmails', 'array-contains', lower), order, lim)),
      () => getDocs(query(col, where('participanteEmails', 'array-contains', lower), lim)),
    ))
  }

  return mergeCotizacionesById(...lists).slice(0, max)
}

/** Comerciales que no deben aparecer en selects (reasignar, participantes, filtros). */
const COMERCIALES_EXCLUIDOS_LISTADO = ['eduardo', 'zaida'] as const

export function normComercialKey(value?: string | null): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
}

export function isComercialExcluidoDelListado(usuario: {
  nombre?: string | null
  email?: string | null
}): boolean {
  const nombre = normComercialKey(usuario.nombre)
  const emailLocal = normComercialKey(usuario.email?.split('@')[0])
  return COMERCIALES_EXCLUIDOS_LISTADO.some(
    excluido => nombre.includes(excluido) || emailLocal.startsWith(excluido),
  )
}

export function filterComercialesList<T extends {
  nombre?: string | null
  email?: string | null
  uid?: string | null
}>(list: T[]): T[] {
  return list.filter(u => u.uid && !isComercialExcluidoDelListado(u))
}

/** Valor especial del filtro de comercial: pendientes de Compras */
export const PENDIENTE_COMPRAS_FILTER_UID = '__pendiente_compras__' as const

export function isPendienteComprasFilterUid(uid: string | null | undefined): boolean {
  return uid === PENDIENTE_COMPRAS_FILTER_UID
}

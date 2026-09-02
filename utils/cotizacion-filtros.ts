import { normalizeStockEstado, stockNeedsCompras, pendienteComprasActive, pendienteSupervisorActive } from '~/utils/stock'
import { comercialHaRespondidoEspera } from '~/utils/workflow'

export type CotizacionFiltroRole = {
  isSupervisor?: boolean
  isCompras?: boolean
}

function norm(v: unknown) {
  return String(v || '').toLowerCase().trim()
}

export function isGanadaCot(c: any) {
  const e = norm(c?.estado)
  return ['ganada', 'ganado', 'ganadas', 'ganados'].includes(e)
}

export function isPerdidaCot(c: any) {
  const e = norm(c?.estado)
  return ['perdida', 'perdido', 'perdidas', 'perdidos'].includes(e)
}

export function isAplazadaCot(c: any) {
  const e = norm(c?.estado)
  return ['aplazada', 'aplazado', 'aplazadas', 'aplazados'].includes(e)
}

export function isCotizadaCot(c: any) {
  return norm(c?.workflow) === 'cotizado'
    && !isGanadaCot(c)
    && !isPerdidaCot(c)
    && !isAplazadaCot(c)
}

/** Sin workflow: pendiente “pura” / sin revisar */
export function isSinRevisarCot(c: any) {
  const e = norm(c?.estado)
  const w = norm(c?.workflow)
  return (!e || e === 'pendiente') && !w
}

/**
 * Reabierta explícita, o pendiente con workflow activo
 * (misma regla que el chip Reabiertas del listado).
 */
export function isReabiertaCot(c: any) {
  const e = norm(c?.estado)
  const w = norm(c?.workflow)
  return e === 'reabierta'
    || ((e === 'pendiente' || !e) && ['en_revision', 'consultando', 'consultando_compras', 'espera_cliente', 'espera_comercial'].includes(w))
}

/**
 * "Pendientes" = requiere acción del rol actual (misma regla que el listado).
 * - Compras: stock pendiente + consultando proveedor/compras
 * - Supervisora: sin revisar / reabiertas / cola supervisora, excluyendo lo que toca a Compras
 * - Comercial: sin revisar + reabiertas
 */
export function isPendienteParaRol(
  c: any,
  role: CotizacionFiltroRole,
): boolean {
  const w = norm(c?.workflow)
  const abierta = !isGanadaCot(c) && !isPerdidaCot(c) && !isAplazadaCot(c) && !isCotizadaCot(c)
  if (!abierta) return false

  if (role.isCompras) {
    if (w === 'consultando' || w === 'consultando_compras') return true
    return pendienteComprasActive(c)
  }

  if (role.isSupervisor) {
    if (pendienteComprasActive(c)) return false
    if (w === 'consultando' || w === 'consultando_compras') return false
    if (w === 'espera_comercial') return comercialHaRespondidoEspera(c)
    return isSinRevisarCot(c) || isReabiertaCot(c) || pendienteSupervisorActive(c)
  }

  return isSinRevisarCot(c) || isReabiertaCot(c)
}

/** Alias útil para KPIs / chips de reabiertas “explícitas” en UI */
export function isReabiertaChip(c: any) {
  return isReabiertaCot(c) && !isGanadaCot(c) && !isPerdidaCot(c) && !isAplazadaCot(c) && !isCotizadaCot(c)
}

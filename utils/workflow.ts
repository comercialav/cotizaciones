import { isCotizacionOwner } from './cotizacion-access'
import { timestampPresent } from './stock'

export type WorkflowKey =
  | 'en_revision'
  | 'consultando'
  | 'consultando_compras'
  | 'espera_cliente'
  | 'espera_comercial'
  | 'cotizado'

export function workflowLabel(w?: string | null): string {
  const key = String(w || '').toLowerCase()

  const map: Record<string, string> = {
    en_revision: 'En revisión',
    consultando: 'Consultando proveedor',
    consultando_compras: 'Consultando a compras',
    espera_cliente: 'A la espera del cliente',
    espera_comercial: 'A la espera del comercial',
    cotizado: 'Cotizada',
  }

  return map[key] || w || '—'
}

/** Etiqueta corta para listados (progreso, chips compactos) */
export function workflowLabelShort(w?: string | null): string {
  const key = String(w || '').toLowerCase()

  const map: Record<string, string> = {
    en_revision: 'En revisión',
    consultando: 'Consulta proveedor',
    consultando_compras: 'Consulta compras',
    espera_cliente: 'Espera cliente',
    espera_comercial: 'Espera comercial',
    cotizado: 'Cotizada',
  }

  return map[key] || w?.replace(/_/g, ' ') || '—'
}

/** Etiqueta del chip de estado en listados (visible para todos los roles) */
export function workflowBadgeLabel(w?: string | null): string | null {
  const key = String(w || '').toLowerCase()
  if (!key) return null
  return workflowLabelShort(w)
}

/** Color del chip de workflow en listados y detalle */
export function workflowBadgeColor(w?: string | null): string {
  const key = String(w || '').toLowerCase()

  const map: Record<string, string> = {
    en_revision: 'amber-darken-2',
    consultando: 'info',
    consultando_compras: 'teal',
    espera_cliente: 'teal-darken-1',
    espera_comercial: 'lime-darken-3',
    cotizado: 'blue-darken-2',
  }

  return map[key] || 'amber-darken-2'
}

type ComercialRespuestaSource = {
  workflow?: string | null
  comercialRespondioAt?: unknown
  comercialRespondio?: boolean | null
}

export function comercialHaRespondidoEspera(
  source: ComercialRespuestaSource | null | undefined,
): boolean {
  if ((source?.workflow || '').toLowerCase() !== 'espera_comercial') return false
  if (source?.comercialRespondio === true) return true
  return timestampPresent(source?.comercialRespondioAt)
}

export function comentarioEsRespuestaComercial(
  c: {
    tipo?: string | null
    texto?: string | null
    attachment?: unknown
    author?: { uid?: string | null; email?: string | null } | null
  } | null | undefined,
  cot: unknown,
): boolean {
  if (!c || c.tipo === 'actividad') return false
  if (!String(c.texto || '').trim() && !c.attachment) return false
  return isCotizacionOwner(c.author?.uid, cot, c.author?.email)
}

export function comercialRespondioEnChat(
  comments: unknown[] | null | undefined,
  cot: unknown,
): boolean {
  return (comments || []).some(c => comentarioEsRespuestaComercial(c as Parameters<typeof comentarioEsRespuestaComercial>[0], cot))
}

import { isRichTextEmpty } from './format-text'

export type StockEstado = 'con_stock' | 'sin_stock' | 'parcial'

export const STOCK_OPCIONES: { value: StockEstado; label: string; hint: string }[] = [
  { value: 'con_stock', label: 'Con stock', hint: 'Hay unidades de todos los artículos' },
  { value: 'parcial', label: 'Stock parcial', hint: 'Faltan unidades o algún componente' },
  { value: 'sin_stock', label: 'Sin stock', hint: 'No hay disponibilidad en almacén' },
]

export function normalizeStockEstado(source: {
  stockEstado?: string | null
  stockDisponible?: boolean | null
  comentarioStock?: string | null
} | null | undefined): StockEstado {
  const raw = source?.stockEstado
  if (raw === 'con_stock' || raw === 'sin_stock' || raw === 'parcial') return raw
  if (source?.stockDisponible === false) return 'sin_stock'
  if (!isRichTextEmpty(source?.comentarioStock)) return 'parcial'
  return 'con_stock'
}

export function stockEstadoLabel(estado: StockEstado): string {
  return STOCK_OPCIONES.find(o => o.value === estado)?.label ?? 'Con stock'
}

export function stockNeedsCompras(estado: StockEstado): boolean {
  return estado === 'sin_stock' || estado === 'parcial'
}

/** Campo legacy para filtros y compatibilidad */
export function stockDisponibleLegacy(estado: StockEstado): boolean {
  return estado === 'con_stock'
}

export function stockChipColor(estado: StockEstado): string {
  if (estado === 'sin_stock') return 'error'
  if (estado === 'parcial') return 'warning'
  return 'success'
}

export function stockEstadoFromBody(body: any): StockEstado {
  return normalizeStockEstado({
    stockEstado: body?.stockEstado ?? body?.resumen?.stockEstado,
    stockDisponible: body?.stockDisponible ?? body?.resumen?.stockDisponible,
    comentarioStock: body?.comentarioStock ?? body?.resumen?.comentarioStock,
  })
}

export function isCotizacionCerrada(source: { estado?: string | null } | null | undefined): boolean {
  const e = (source?.estado || '').toLowerCase()
  return e === 'ganada' || e === 'perdida'
}

export function cotizacionAbierta(source: {
  estado?: string | null
  workflow?: string | null
} | null | undefined): boolean {
  if (!source || isCotizacionCerrada(source)) return false
  return (source.workflow || '').toLowerCase() !== 'cotizado'
}

export function timestampPresent(v: unknown): boolean {
  if (v == null || v === '') return false
  if (typeof v === 'number' && v > 0) return true
  if (typeof v === 'string' && v.trim()) return true
  if (v instanceof Date && !isNaN(v.getTime())) return true
  if (typeof v === 'object') {
    const o = v as { seconds?: number; _seconds?: number; toMillis?: () => number; toDate?: () => Date }
    if (typeof o.seconds === 'number') return true
    if (typeof o._seconds === 'number') return true
    if (typeof o.toMillis === 'function') return true
    if (typeof o.toDate === 'function') return true
  }
  return Boolean(v)
}

export function authorEsCompras(author?: { rol?: string | null; email?: string | null } | null): boolean {
  const rol = (author?.rol || '').toLowerCase()
  const mail = (author?.email || '').toLowerCase()
  return rol === 'compras' || mail === 'compras@comercialav.com'
}

export function comentarioEsRespuestaCompras(c: {
  tipo?: string | null
  texto?: string | null
  attachment?: unknown
  author?: { rol?: string | null; email?: string | null } | null
} | null | undefined): boolean {
  if (!c || !authorEsCompras(c.author)) return false
  if (c.tipo === 'actividad') return true
  return Boolean(String(c.texto || '').trim() || c.attachment)
}

export function comprasRespondioEnChat(comments: unknown[] | null | undefined): boolean {
  return (comments || []).some(c => comentarioEsRespuestaCompras(c as Parameters<typeof comentarioEsRespuestaCompras>[0]))
}

export function comprasHaRespondido(
  source: { comprasAtendidoAt?: unknown; comprasRespondio?: boolean | null } | null | undefined,
  comments?: unknown[] | null,
): boolean {
  if (source?.comprasRespondio === true) return true
  if (timestampPresent(source?.comprasAtendidoAt)) return true
  if (comments?.length) return comprasRespondioEnChat(comments)
  return false
}

export function shouldResetComprasAtendido(prev: StockEstado, next: StockEstado): boolean {
  return stockNeedsCompras(next) && prev !== next
}

type PendienteSource = {
  estado?: string | null
  workflow?: string | null
  stockEstado?: string | null
  stockDisponible?: boolean | null
  comentarioStock?: string | null
  comprasAtendidoAt?: unknown
  comprasRespondio?: boolean | null
}

/** Cotización abierta con sin stock / parcial que aún espera respuesta de Compras */
export function pendienteComprasActive(
  source: PendienteSource | null | undefined,
  comments?: unknown[] | null,
): boolean {
  if (!source || !cotizacionAbierta(source)) return false
  if (comprasHaRespondido(source, comments)) return false
  return stockNeedsCompras(normalizeStockEstado(source))
}

/** Compras ya respondió; pendiente de la supervisora (solo sin stock / parcial) */
export function pendienteSupervisorActive(
  source: PendienteSource | null | undefined,
  comments?: unknown[] | null,
): boolean {
  if (!source || !cotizacionAbierta(source)) return false
  if (!comprasHaRespondido(source, comments)) return false
  return stockNeedsCompras(normalizeStockEstado(source))
}

/** Cotizaciones que Compras ve en su listado Pendientes (filtro supervisora) */
export function pendienteEnColaCompras(
  source: PendienteSource | null | undefined,
  comments?: unknown[] | null,
): boolean {
  if (!source || !cotizacionAbierta(source)) return false
  const w = String(source.workflow || '').toLowerCase()
  if (w === 'consultando' || w === 'consultando_compras') return true
  return pendienteComprasActive(source, comments)
}

export type PendienteStripKind = 'compras' | 'supervisor'

export function pendienteStripState(
  source: PendienteSource | null | undefined,
  opts?: { forCompras?: boolean; comments?: unknown[] | null },
): { kind: PendienteStripKind; meta: ReturnType<typeof pendienteComprasMeta> } | null {
  const comments = opts?.comments
  const estado = normalizeStockEstado(source)
  if (pendienteComprasActive(source, comments)) {
    return { kind: 'compras', meta: pendienteComprasMeta(estado) }
  }
  if (pendienteSupervisorActive(source, comments)) {
    return { kind: 'supervisor', meta: pendienteSupervisorMeta(estado, opts?.forCompras) }
  }
  return null
}

export function pendienteComprasText(estado: StockEstado): string {
  if (estado === 'sin_stock') return 'Sin stock'
  if (estado === 'parcial') return 'Stock parcial'
  return ''
}

export function pendienteComprasMeta(estado: StockEstado) {
  return {
    title: 'Pendiente de compras',
    stockTag: pendienteComprasText(estado),
    hint: 'Revisar disponibilidad y responder en el chat de la cotización',
  }
}

export function pendienteSupervisorMeta(estado: StockEstado, forCompras = false) {
  return {
    title: 'Pendiente de supervisora',
    stockTag: pendienteComprasText(estado),
    hint: forCompras
      ? 'Ya respondiste. En espera de que la supervisora revise y cotice.'
      : 'Compras ya respondió. Pendiente de revisión y cotización.',
  }
}

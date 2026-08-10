/** Algún artículo marcado como comprado antes */
export function cotizacionCompradoAntes(articulos: { compradoAntes?: boolean }[] = []): boolean {
  return articulos.some(a => !!a.compradoAntes)
}

export type ArticuloIdentidad = {
  codigoProducto?: string | null
  descripcionProducto?: string | null
  articulo?: string | null
}

/** Separa líneas legacy guardadas solo en `articulo` */
export function parseLegacyArticulo(articulo?: string | null): {
  codigoProducto: string
  descripcionProducto: string
} {
  const raw = String(articulo || '').trim()
  if (!raw) return { codigoProducto: '', descripcionProducto: '' }

  const sep = raw.indexOf(' - ')
  if (sep > 0) {
    return {
      codigoProducto: raw.slice(0, sep).trim(),
      descripcionProducto: raw.slice(sep + 3).trim(),
    }
  }

  return { codigoProducto: '', descripcionProducto: raw }
}

export function articuloLabel(a: ArticuloIdentidad): string {
  const codigo = String(a.codigoProducto ?? '').trim()
  const desc = String(a.descripcionProducto ?? '').trim()
  if (codigo && desc) return `${codigo} - ${desc}`
  if (codigo) return codigo
  if (desc) return desc
  return String(a.articulo ?? '').trim()
}

export function hydrateArticuloIdentidad(a: Record<string, unknown>): {
  codigoProducto: string
  descripcionProducto: string
  articulo: string
} {
  let codigoProducto = String(a.codigoProducto ?? '').trim()
  let descripcionProducto = String(a.descripcionProducto ?? '').trim()

  if (!codigoProducto && !descripcionProducto && a.articulo) {
    const parsed = parseLegacyArticulo(String(a.articulo))
    codigoProducto = parsed.codigoProducto
    descripcionProducto = parsed.descripcionProducto
  }

  const articulo = articuloLabel({ codigoProducto, descripcionProducto, articulo: a.articulo as string })
  return { codigoProducto, descripcionProducto, articulo }
}

export function buildArticuloIdentidad(input: {
  codigoProducto?: string | null
  descripcionProducto?: string | null
}): {
  codigoProducto: string
  descripcionProducto: string
  articulo: string
} {
  const codigoProducto = String(input.codigoProducto ?? '').trim()
  const descripcionProducto = String(input.descripcionProducto ?? '').trim()
  return {
    codigoProducto,
    descripcionProducto,
    articulo: articuloLabel({ codigoProducto, descripcionProducto }),
  }
}

export function validarArticuloIdentidad(
  a: { codigoProducto?: string | null; descripcionProducto?: string | null },
  i: number,
  errores: string[],
) {
  if (!String(a.codigoProducto ?? '').trim()) {
    errores.push(`Artículo ${i + 1}: falta el código de producto.`)
  }
  if (!String(a.descripcionProducto ?? '').trim()) {
    errores.push(`Artículo ${i + 1}: falta la descripción de producto.`)
  }
}

/** Normaliza campos por línea; migra datos legacy de cabecera al primer artículo */
export function mapArticuloCompradoAntes(
  a: Record<string, unknown>,
  idx: number,
  legacy?: { compradoAntes?: boolean; precioAnterior?: number | null },
): { compradoAntes: boolean; precioAnterior: number | null } {
  const lineHasFlag = a.compradoAntes != null || a.precioAnterior != null
  if (lineHasFlag) {
    const compradoAntes = !!a.compradoAntes
    const precioAnterior = compradoAntes && a.precioAnterior != null && a.precioAnterior !== ''
      ? Number(a.precioAnterior)
      : null
    return { compradoAntes, precioAnterior }
  }
  if (legacy?.compradoAntes && idx === 0) {
    return {
      compradoAntes: true,
      precioAnterior: legacy.precioAnterior != null ? Number(legacy.precioAnterior) : null,
    }
  }
  return { compradoAntes: false, precioAnterior: null }
}

/**
 * Fusiona la línea editada en formulario con la original en Firestore.
 * Conserva campos que el formulario no gestiona (precioCotizado, comprado, etc.).
 */
export function mergeArticuloEdicion(
  original: Record<string, unknown> | null | undefined,
  edited: Record<string, unknown>,
): Record<string, unknown> {
  if (!original || typeof original !== 'object') return { ...edited }
  return { ...original, ...edited }
}

export function formatPrecioAnteriorLinea(a: { compradoAntes?: boolean; precioAnterior?: number | null }): string {
  if (!a.compradoAntes) return '—'
  if (a.precioAnterior == null || Number.isNaN(Number(a.precioAnterior))) return '—'
  return `€ ${Number(a.precioAnterior).toFixed(2)}`
}

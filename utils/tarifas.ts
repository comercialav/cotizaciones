export type TarifaCodigo = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7'

export const TARIFA_CODIGOS: TarifaCodigo[] = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']

export const TARIFA_NOMBRES: Record<TarifaCodigo, string> = {
  A1: 'Tarifa especial',
  A2: 'Tarifa PVD',
  A3: 'Tarifa PVD / 0,97%',
  A4: 'Tarifa empresas',
  A5: 'Tarifa PVP',
  A6: 'Tarifa PVD / 0,95%',
  A7: 'Tarifa PVD -3%',
}

export function tarifaNombre(codigo?: string | null): string {
  const c = String(codigo || '').trim().toUpperCase() as TarifaCodigo
  return TARIFA_NOMBRES[c] || String(codigo || '').trim() || '—'
}

/** Ej.: A1 - Tarifa especial */
export function tarifaLabel(codigo?: string | null): string {
  const c = String(codigo || '').trim().toUpperCase()
  if (!c) return '—'
  const nombre = TARIFA_NOMBRES[c as TarifaCodigo]
  return nombre ? `${c} - ${nombre}` : c
}

export function tarifaSelectItems() {
  return TARIFA_CODIGOS.map(value => ({
    title: tarifaLabel(value),
    value,
  }))
}

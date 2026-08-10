export type TipoEntrega = 'recogida' | 'envio'

export const TIPO_ENTREGA_OPCIONES: { value: TipoEntrega; label: string; hint: string }[] = [
  { value: 'recogida', label: 'Recogida', hint: 'El cliente recoge en almacén o tienda' },
  { value: 'envio', label: 'Envío', hint: 'Entrega en la dirección indicada' },
]

export function tipoEntregaLabel(tipo?: string | null): string {
  return TIPO_ENTREGA_OPCIONES.find(o => o.value === tipo)?.label ?? '—'
}

export function isTipoEntregaValid(tipo?: string | null): tipo is TipoEntrega {
  return tipo === 'recogida' || tipo === 'envio'
}

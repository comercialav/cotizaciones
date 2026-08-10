/** Total tarifa (precio cliente / PVP tarifa por línea) */
export function sumLineasTarifa(articulos: any[] | null | undefined): number {
  return (articulos || []).reduce(
    (a, r) => a + (Number(r.unidades) || 0) * (Number(r.precioCliente) || 0),
    0,
  )
}

/** Total cotizado (precio que fija la supervisora por línea) */
export function sumLineasPrecioCotizado(articulos: any[] | null | undefined): number {
  return (articulos || []).reduce(
    (a, r) => a + (Number(r.unidades) || 0) * (Number(r.precioCotizado) || 0),
    0,
  )
}

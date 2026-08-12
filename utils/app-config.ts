export type AppConfig = {
  /** Si true, el rol compras puede cotizar / recotizar / editar precio cotizado */
  comprasPuedeCotizar: boolean
}

export function defaultAppConfig(): AppConfig {
  return {
    comprasPuedeCotizar: false,
  }
}

export function mergeAppConfig(raw?: Partial<AppConfig> | null): AppConfig {
  const base = defaultAppConfig()
  if (!raw || typeof raw !== 'object') return base
  return {
    comprasPuedeCotizar: raw.comprasPuedeCotizar === true,
  }
}

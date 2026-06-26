export type NotifEventChannels = { email: boolean; slack: boolean }

export interface NotificacionesConfig {
  emailEnabled: boolean
  slackEnabled: boolean
  events: Record<string, NotifEventChannels>
}

export interface NotifEventMeta {
  id: string
  label: string
  description: string
  when: string
  recipients: string
  channels: { email: boolean; slack: boolean }
  group: 'cotizacion' | 'comentarios' | 'gestion'
}

export const NOTIF_GROUPS: Record<NotifEventMeta['group'], string> = {
  cotizacion: 'Ciclo de la cotización',
  comentarios: 'Comentarios',
  gestion: 'Gestión interna',
}

export const NOTIF_EVENT_DEFS: NotifEventMeta[] = [
  {
    id: 'solicitud',
    label: 'Nueva solicitud de cotización',
    description: 'Avisa de que se ha creado una cotización nueva y hay que revisarla.',
    when: 'Al guardar una cotización en «Nueva cotización»',
    recipients: 'Comercial y supervisor. Si no hay stock, también compras.',
    channels: { email: true, slack: false },
    group: 'cotizacion',
  },
  {
    id: 'cotizada',
    label: 'Cotización cerrada / recotizada',
    description: 'Confirma que la cotización ya tiene precios y está lista para el comercial.',
    when: 'Cuando el supervisor confirma la cotización o una recotización',
    recipients: 'Comercial asignado y supervisor',
    channels: { email: true, slack: true },
    group: 'cotizacion',
  },
  {
    id: 'ganada',
    label: 'Cotización ganada',
    description: 'Informa de que el cliente ha confirmado la compra.',
    when: 'Cuando el comercial marca la cotización como ganada',
    recipients: 'Comercial y supervisor',
    channels: { email: true, slack: true },
    group: 'cotizacion',
  },
  {
    id: 'perdida',
    label: 'Cotización perdida',
    description: 'Informa de que la oportunidad no se ha cerrado a favor.',
    when: 'Cuando el comercial marca la cotización como perdida',
    recipients: 'Comercial y supervisor',
    channels: { email: true, slack: true },
    group: 'cotizacion',
  },
  {
    id: 'comentario_privado',
    label: 'Comentario privado',
    description: 'Comunicación restringida entre supervisor, compras y comercial.',
    when: 'Al publicar un comentario con visibilidad privada',
    recipients: 'Email → compras (desde supervisor). Slack → supervisor (desde compras/comercial).',
    channels: { email: true, slack: true },
    group: 'comentarios',
  },
  {
    id: 'comentario_publico',
    label: 'Comentario público',
    description: 'Mensaje visible para todos los roles con acceso a la cotización.',
    when: 'Al publicar un comentario público en el chat',
    recipients: 'La contraparte del hilo (comercial ↔ supervisor)',
    channels: { email: false, slack: true },
    group: 'comentarios',
  },
  {
    id: 'recotizacion',
    label: 'Solicitud de recotización',
    description: 'El comercial pide revisar precios de una cotización ya cerrada.',
    when: 'Al pulsar «Solicitar recotización»',
    recipients: 'Supervisor (email y Slack)',
    channels: { email: true, slack: true },
    group: 'gestion',
  },
  {
    id: 'workflow',
    label: 'Cambio de estado interno',
    description: 'En revisión, consultando proveedor o a la espera del cliente.',
    when: 'Al cambiar el workflow de la cotización',
    recipients: 'Comercial o supervisor según quién actúe',
    channels: { email: false, slack: true },
    group: 'gestion',
  },
  {
    id: 'reasignacion',
    label: 'Reasignación de comercial',
    description: 'La cotización pasa a otro vendedor.',
    when: 'Cuando el supervisor reasigna la cotización',
    recipients: 'Contraparte habitual del hilo',
    channels: { email: false, slack: true },
    group: 'gestion',
  },
  {
    id: 'adjunto',
    label: 'Archivo adjunto',
    description: 'Alguien sube un documento desde el chat.',
    when: 'Al adjuntar un archivo en comentarios',
    recipients: 'Contraparte habitual del hilo',
    channels: { email: false, slack: true },
    group: 'gestion',
  },
  {
    id: 'precio_cotizado',
    label: 'Precio cotizado editado',
    description: 'El supervisor modifica un precio ya cotizado.',
    when: 'Al guardar un precio cotizado inline',
    recipients: 'Comercial asignado',
    channels: { email: false, slack: true },
    group: 'gestion',
  },
  {
    id: 'linea_compras',
    label: 'Artículo añadido por compras',
    description: 'Compras incorpora una línea nueva a la cotización.',
    when: 'Cuando compras añade un artículo',
    recipients: 'Supervisor',
    channels: { email: false, slack: true },
    group: 'gestion',
  },
]

export function defaultNotificacionesConfig(): NotificacionesConfig {
  const events: Record<string, NotifEventChannels> = {}
  for (const def of NOTIF_EVENT_DEFS) {
    events[def.id] = {
      email: def.channels.email,
      slack: def.channels.slack,
    }
  }
  return {
    emailEnabled: true,
    slackEnabled: true,
    events,
  }
}

export function mergeNotificacionesConfig(raw: Partial<NotificacionesConfig> | null | undefined): NotificacionesConfig {
  const defaults = defaultNotificacionesConfig()
  if (!raw) return defaults

  const events = { ...defaults.events }
  for (const id of Object.keys(defaults.events)) {
    events[id] = {
      email: raw.events?.[id]?.email ?? defaults.events[id].email,
      slack: raw.events?.[id]?.slack ?? defaults.events[id].slack,
    }
  }

  return {
    emailEnabled: typeof raw.emailEnabled === 'boolean' ? raw.emailEnabled : defaults.emailEnabled,
    slackEnabled: typeof raw.slackEnabled === 'boolean' ? raw.slackEnabled : defaults.slackEnabled,
    events,
  }
}

export function canSendEmail(cfg: NotificacionesConfig, eventId: string): boolean {
  if (!cfg.emailEnabled) return false
  return cfg.events[eventId]?.email ?? false
}

export function canSendSlack(cfg: NotificacionesConfig, eventId: string): boolean {
  if (!cfg.slackEnabled) return false
  return cfg.events[eventId]?.slack ?? false
}

export function actionToEventId(action: string): string {
  const a = action.toLowerCase()
  if (a === 'solicitud' || a === 'solicitud_cotizacion') return 'solicitud'
  if (a === 'comentario_privado') return 'comentario_privado'
  return a
}

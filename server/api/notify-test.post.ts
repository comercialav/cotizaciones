// server/api/notify-test.post.ts
// Envía notificaciones de PRUEBA (email y/o Slack) para un evento concreto.
// Ignora los interruptores de configuración a propósito: sirve para comprobar
// que la conectividad (SMTP / Slack) funciona, independientemente de si el
// aviso está activado para el flujo real.
import { defineEventHandler, readBody } from 'h3'
import { renderTemplate, renderItemsTable, renderCotizadaTable, sendMail } from '~/server/utils/mail'
import { sendSlackDM } from '~/server/utils/slack'
import { NOTIF_EVENT_DEFS } from '~/utils/notificaciones'

const TEST_PREFIX = '[PRUEBA]'

function sampleArticulos() {
  return [
    {
      articulo: 'Monitor LED 24" Full HD',
      unidades: 5,
      precioCliente: 129.9,
      precioSolicitado: 109.0,
      precioCompetencia: 119.0,
      precioCotizado: 112.5,
      comprado: true,
    },
    {
      articulo: 'Teclado mecánico inalámbrico',
      unidades: 12,
      precioCliente: 59.9,
      precioSolicitado: 49.0,
      precioCompetencia: 54.0,
      precioCotizado: 51.0,
      comprado: false,
    },
  ]
}

function buildSample(overrides: Record<string, any> = {}) {
  const articulos = sampleArticulos()
  const totalTarifa = articulos.reduce((s, a) => s + a.unidades * a.precioCliente, 0)
  const totalCotizado = articulos.reduce((s, a) => s + a.unidades * (a.precioCotizado || 0), 0)
  return {
    numero: overrides.numero || 'DEMO-1024',
    cliente: overrides.cliente || 'Cliente de ejemplo S.L.',
    vendedorNombre: 'Vanessa (comercial demo)',
    vendedorEmail: 'vanessa@comercialav.com',
    tarifa: 'Tarifa general',
    articulos,
    totalTarifa,
    totalCotizado,
  }
}

function labelFor(eventId: string) {
  return NOTIF_EVENT_DEFS.find((e) => e.id === eventId)?.label || eventId
}

async function buildTestEmail(eventId: string, sample: ReturnType<typeof buildSample>) {
  const now = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  const { numero, cliente } = sample

  if (eventId === 'solicitud') {
    const html = await renderTemplate('solicitud-cotizacion.html', {
      date: now,
      current_year: new Date().getFullYear(),
      numero,
      cliente,
      tarifa: sample.tarifa,
      vendedor: sample.vendedorNombre,
      stock_disponible: 'Sí',
      licitacion: 'No',
      total_cotizado: sample.totalCotizado.toFixed(2),
      items: renderItemsTable(sample.articulos, true),
      cliente_final: 'Hospital de ejemplo',
      comprado_antes: 'Sí',
      precio_anterior: '110.00',
      precio_competencia: '119.00',
      fecha_decision: '30/06/2026',
      plazo_entrega: '7 días',
      lugar_entrega: 'Almacén central',
      forma_pago_actual: 'Transferencia 30 días',
      forma_pago_solicitada: 'Transferencia 60 días',
      comentario_stock: 'Disponible en almacén.',
      comentarios: 'Cotización de ejemplo generada desde el panel de pruebas.',
    })
    return { subject: `${TEST_PREFIX} 📝 Solicitud de cotización #${numero} – ${cliente}`, html }
  }

  if (eventId === 'cotizada') {
    const totalTarifa = sample.totalTarifa
    const totalCotizado = sample.totalCotizado
    const html = await renderTemplate('cotizacion-cotizada.html', {
      now,
      numero,
      cliente,
      vendedorNombre: sample.vendedorNombre,
      vendedorEmail: sample.vendedorEmail,
      tarifa: sample.tarifa,
      licitacion: 'No',
      stock: 'Con stock',
      formaPagoSolicitada: 'Transferencia 60 días',
      formaPagoActual: 'Transferencia 30 días',
      fechaDecision: '30/06/2026',
      compradoAntes: 'Sí',
      precioAnterior: '110.00',
      plazoEntrega: '7 días',
      lugarEntrega: 'Almacén central',
      comentarioStock: 'Disponible en almacén.',
      comentariosCliente: 'Cotización de ejemplo generada desde el panel de pruebas.',
      clienteFinal: 'Hospital de ejemplo',
      itemsTable: renderCotizadaTable(sample.articulos),
      adjuntosBlock: '—',
      totalTarifa: totalTarifa.toFixed(2),
      totalCotizado: totalCotizado.toFixed(2),
      observaciones: 'Mensaje de prueba. Revisa que el formato se vea correcto.',
      ahorroPct: totalTarifa ? (((totalTarifa - totalCotizado) / totalTarifa) * 100).toFixed(0) : '0',
      ahorro: (totalTarifa - totalCotizado).toFixed(2),
      currentYear: new Date().getFullYear(),
    })
    return { subject: `${TEST_PREFIX} ✅ Cotización COTIZADA #${numero} – ${cliente}`, html }
  }

  if (eventId === 'ganada' || eventId === 'perdida') {
    const estado = eventId === 'ganada' ? 'ganada' : 'perdida'
    const html = await renderTemplate('cotizacion-ganada-perdida.html', {
      now,
      numero,
      cliente,
      totalCotizado: sample.totalCotizado.toFixed(2),
      estado,
      estadoLabel: estado === 'ganada' ? 'Ganada' : 'Perdida',
      itemsTable: renderItemsTable(sample.articulos.filter((a) => a.comprado)),
      observaciones: 'Mensaje de prueba enviado desde el panel de notificaciones.',
      current_year: new Date().getFullYear(),
    })
    return {
      subject: `${TEST_PREFIX} Cotización #${numero} – ${eventId === 'ganada' ? '¡Ganada! ✅' : 'Perdida ❌'}`,
      html,
    }
  }

  if (eventId === 'recotizacion') {
    const html = await renderTemplate('recotizacion.html', {
      now,
      numero,
      cliente,
      comercial: 'Comercial demo',
      motivo: 'El cliente pide revisar precios por competencia. Mensaje de prueba desde el panel de notificaciones.',
      totalCotizado: sample.totalCotizado.toFixed(2),
      itemsTable: renderCotizadaTable(sample.articulos),
      cotizacionId: 'demo-cotizacion-id',
      current_year: new Date().getFullYear(),
    })
    return { subject: `${TEST_PREFIX} 🔁 Recotización solicitada – Cotización #${numero} – ${cliente}`, html }
  }

  if (eventId === 'comentario_privado') {
    const html = await renderTemplate('comentario-privado.html', {
      now,
      numero,
      cliente,
      articulo: sample.articulos[0].articulo,
      autor: 'Supervisor (demo)',
      comentario: 'Este es un comentario privado de ejemplo para comprobar el formato del correo.',
      cotizacionId: 'demo-cotizacion-id',
      current_year: new Date().getFullYear(),
    })
    return { subject: `${TEST_PREFIX} 🔒 Comentario privado – Cotización #${numero} – ${cliente}`, html }
  }

  // Eventos que normalmente solo van por Slack: enviamos un email genérico
  // para poder comprobar igualmente la conectividad SMTP.
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5;">
      <h2 style="margin:0 0 8px;">${TEST_PREFIX} ${labelFor(eventId)}</h2>
      <p>Este es un correo de <strong>prueba</strong> para el aviso «${labelFor(eventId)}».</p>
      <p>En el flujo real este aviso suele enviarse por Slack, pero te lo mandamos por email
      para que puedas comprobar que la entrega de correo funciona correctamente.</p>
      <p style="color:#64748b;font-size:13px;">Cotización de ejemplo: #${numero} – ${cliente}</p>
    </div>
  `
  return { subject: `${TEST_PREFIX} ${labelFor(eventId)} (cotización #${numero})`, html }
}

function buildTestSlackText(eventId: string, sample: ReturnType<typeof buildSample>) {
  const { numero, cliente } = sample
  const ref = `#${numero} – ${cliente}`
  const map: Record<string, string> = {
    solicitud: `📝 *PRUEBA* · Nueva solicitud de cotización ${ref}`,
    cotizada: `✅ *PRUEBA* · La cotización ${ref} ya está cotizada y lista para revisar.`,
    ganada: `🏆 *PRUEBA* · La cotización ${ref} se ha marcado como GANADA.`,
    perdida: `🙁 *PRUEBA* · La cotización ${ref} se ha marcado como PERDIDA.`,
    comentario_privado: `🔒 *PRUEBA* · Nuevo comentario privado en la cotización ${ref}.`,
    comentario_publico: `💬 *PRUEBA* · Nuevo comentario público en la cotización ${ref}.`,
    recotizacion: `🔁 *PRUEBA* · Solicitud de recotización para ${ref}.`,
    workflow: `🔧 *PRUEBA* · Cambio de estado interno en la cotización ${ref}.`,
    reasignacion: `🔁 *PRUEBA* · La cotización ${ref} se ha reasignado a otro comercial.`,
    adjunto: `📎 *PRUEBA* · Se ha adjuntado un archivo en la cotización ${ref}.`,
    precio_cotizado: `💶 *PRUEBA* · Se ha editado un precio cotizado en ${ref}.`,
    linea_compras: `🧾 *PRUEBA* · Compras añadió una línea a la cotización ${ref}.`,
  }
  return map[eventId] || `🔔 *PRUEBA* · Aviso «${labelFor(eventId)}» para ${ref}.`
}

export default defineEventHandler(async (event) => {
  const body = await readBody<any>(event).catch(() => null)
  const eventId = String(body?.eventId || '').trim()
  const email = String(body?.email || '').trim()
  const slackEmail = String(body?.slackEmail || '').trim()

  if (!eventId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta eventId' })
  }
  if (!NOTIF_EVENT_DEFS.some((e) => e.id === eventId)) {
    throw createError({ statusCode: 400, statusMessage: `Evento desconocido: ${eventId}` })
  }
  if (!email && !slackEmail) {
    throw createError({ statusCode: 400, statusMessage: 'Indica al menos un email o un usuario de Slack' })
  }

  const sample = buildSample({
    cliente: body?.cliente,
    numero: body?.numero,
  })

  const result: {
    eventId: string
    email: { attempted: boolean; ok: boolean; error?: string; accepted?: string[]; rejected?: string[] }
    slack: { attempted: boolean; ok: boolean; error?: string }
  } = {
    eventId,
    email: { attempted: false, ok: false },
    slack: { attempted: false, ok: false },
  }

  if (email) {
    result.email.attempted = true
    try {
      const { subject, html } = await buildTestEmail(eventId, sample)
      const info: any = await sendMail({ to: email, subject, html })
      result.email.ok = true
      result.email.accepted = info?.accepted as string[] | undefined
      result.email.rejected = info?.rejected as string[] | undefined
      if (Array.isArray(info?.rejected) && info.rejected.length) {
        result.email.ok = false
        result.email.error = `El servidor rechazó: ${info.rejected.join(', ')}`
      }
    } catch (e: any) {
      result.email.ok = false
      result.email.error = e?.message || 'Error enviando email'
    }
  }

  if (slackEmail) {
    result.slack.attempted = true
    const text = buildTestSlackText(eventId, sample)
    const slackRes = await sendSlackDM({ toEmail: slackEmail, text })
    result.slack.ok = slackRes.ok
    if (!slackRes.ok) result.slack.error = slackRes.error
  }

  const anyOk = (result.email.attempted && result.email.ok) || (result.slack.attempted && result.slack.ok)
  return { ok: anyOk, ...result }
})

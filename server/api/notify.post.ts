// filepath: server/api/notify.post.ts
import { defineEventHandler, readBody } from 'h3'
import { renderTemplate, renderItemsTable, renderCotizadaTable, sendMail } from '~/server/utils/mail'

function ensureArray<T>(v: T | T[] | null | undefined): T[] {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

export default defineEventHandler(async (event) => {
  console.group('[API] /api/notify POST')
  const body = await readBody<any>(event).catch((e:any)=> {
    console.error('[API] readBody ERROR:', e)
    return null
  })
  console.log('[API] raw body keys:', body ? Object.keys(body) : '(null)')
  const action = String(body?.action || '').toLowerCase()
  console.log('[API] action:', action)

  // destinatarios
  const to: string[] = [
    ...ensureArray(body?.destinatarios?.comercial),
    ...ensureArray(body?.destinatarios?.supervisor),
  ].filter(Boolean)

  console.log('[API] destinatarios.to:', to)
  if (!to.length) {
    console.warn('[API] Sin destinatarios -> abort')
    console.groupEnd()
    return { ok: false, error: 'Sin destinatarios' }
  }

  const now = new Date()
  const nowStr = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(now)
  const cliente = body?.cliente || '—'
  const numero  = body?.numero || '—'
  console.log('[API] numero:', numero, 'cliente:', cliente)

  try {
    if (action === 'solicitud' || action === 'solicitud_cotizacion') {
      console.group('[API] action: solicitud')
      const itemsHtml = renderItemsTable(body?.articulos || [])
      const html = await renderTemplate('solicitud-cotizacion.html', {
        now: nowStr,
        numero,
        cliente,
        vendedor: body?.vendedor || '',
        formaPagoSolicitada: body?.formaPagoSolicitada || '',
        stockDisponible: body?.stockDisponible ? 'Sí' : 'No',
        observaciones: body?.comentarios || '',
        itemsTable: itemsHtml,
        totalSolicitado: Number(body?.totalSolicitado || 0).toFixed(2),
      })
      const subject = `📝 Solicitud de cotización #${numero} – ${cliente}`
      console.log('[API] subject:', subject)
      await sendMail({ to, subject, html })
      console.groupEnd()
      console.groupEnd()
      return { ok: true }
    }

    if (action === 'cotizada') {
  console.group('[API] action: cotizada')

  // --- DEBUG BODY ---
  const keys = Object.keys(body || {})
  console.log('[API] raw keys:', keys)
  console.log('[API] numero:', numero, 'cliente:', cliente)
  console.log('[API] vendedor:', body?.vendedor)
  console.log('[API] licitacion:', body?.licitacion, 'stockDisponible:', body?.stockDisponible)
  console.log('[API] formaPagoSolicitada:', body?.formaPagoSolicitada)
  console.log('[API] fechaDecision:', body?.fechaDecision, 'compradoAntes:', body?.compradoAntes, 'precioAnterior:', body?.precioAnterior)
  console.log('[API] plazoEntrega:', body?.plazoEntrega, 'lugarEntrega:', body?.lugarEntrega)
  console.log('[API] comentarioStock:', body?.comentarioStock)
  console.log('[API] comentariosCliente:', body?.comentariosCliente)

  // Artículos
  const articulos = Array.isArray(body?.articulos) ? body.articulos : []


  // Adjuntos (opcional)
  const adjuntos = Array.isArray(body?.adjuntos) ? body.adjuntos : []
  console.log('[API] adjuntos count:', adjuntos.length)

  // Totales y obs
  const totalTarifa = Number(body?.totalTarifa || 0)
  const totalCotizado = Number(body?.totalCotizado || 0)
  console.log('[API] totales => tarifa:', totalTarifa, 'cotizado:', totalCotizado)
  console.log('[API] observaciones:', body?.observaciones)

  // Render tabla de artículos (usa tu helper que ya formatea)
  const itemsHtml = renderCotizadaTable(articulos) 

  // (Opcional) bloque de adjuntos simple
  const adjuntosHtml = adjuntos.length
    ? ('<ul style="margin:6px 0 0 16px;padding:0;">' +
       adjuntos.map((a:any)=>`<li><a href="${a.url}" target="_blank" style="color:#3c9ae0">${a.nombre || 'Archivo'}</a></li>`).join('') +
       '</ul>')
    : ''

  // Plantilla
  const html = await renderTemplate('cotizacion-cotizada.html', {
    now: nowStr,
    numero,
    cliente,

    // cabecera / meta
    vendedorNombre: body?.vendedor?.nombre || '',
    vendedorEmail: body?.vendedor?.email || '',
    tarifa: body?.tarifa || '',
    licitacion: body?.licitacion ? 'Sí' : 'No',
    stock: body?.stockDisponible === false ? 'Sin stock' : 'Con stock',
    formaPagoSolicitada: body?.formaPagoSolicitada || '',
    fechaDecision: body?.fechaDecision || '',
    compradoAntes: body?.compradoAntes ? 'Sí' : 'No',
    precioAnterior: (body?.precioAnterior ?? '') === '' ? '' : Number(body?.precioAnterior || 0).toFixed(2),
    plazoEntrega: body?.plazoEntrega || '',
    lugarEntrega: body?.lugarEntrega || '',
    comentarioStock: body?.comentarioStock || '',
    comentariosCliente: body?.comentariosCliente || '',

    // detalle
    itemsTable: itemsHtml,
    adjuntosBlock: adjuntosHtml,

    // totales y obs
    totalTarifa: totalTarifa.toFixed(2),
    totalCotizado: totalCotizado.toFixed(2),
    observaciones: body?.observaciones || '',
    ahorroPct: totalTarifa ? (((totalTarifa - totalCotizado) / totalTarifa) * 100).toFixed(0) : '0',
    ahorro: (totalTarifa - totalCotizado).toFixed(2),
  })

  const subject = `✅ Cotización COTIZADA #${numero} – ${cliente}`
  console.log('[API] subject:', subject)

  // Envío
  console.log('[API] enviando a:', to)
  await sendMail({ to, subject, html })

  console.groupEnd()
  return { ok: true }
}


    // Fallback
    console.group('[API] action: desconocida')
    const subject = `Notificación – ${action || 'sin acción'}`
    const html = `<p>Se recibió una notificación no tipificada.</p>
    <pre style="font-size:12px;background:#f6f7f9;padding:12px;border-radius:8px;">${JSON.stringify(body, null, 2)}</pre>`
    console.log('[API] subject:', subject)
    await sendMail({ to, subject, html })
    console.groupEnd()
    console.groupEnd()
    return { ok: true, warn: 'Acción no reconocida' }
  } catch (e:any) {
    console.error('[API] ERROR enviando email:', e?.message || e)
    console.error('[API] STACK:', e?.stack || '(no stack)')
    console.groupEnd()
    return { ok: false, error: e?.message || 'Error enviando email' }
  }
})

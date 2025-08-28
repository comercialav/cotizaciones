// filepath: server/api/notify.post.ts
import nodemailer from "nodemailer"
import { defineEventHandler, readBody, createError } from "h3"
import { renderTemplate, renderItemsTable } from "../utils/mail"

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig()
  const body = await readBody<any>(event)

  // Admitimos ambos esquemas: { resumen: { ... , articulos: [] } } o plano { articulos: [] }
  const resumen   = body?.resumen ?? {}
  const articulos = resumen?.articulos ?? body?.articulos ?? []
  if (!Array.isArray(articulos)) {
    throw createError({ statusCode: 400, statusMessage: "articulos debe ser un array" })
  }

  // Totales
  const totalCotizado = typeof resumen.totalCotizado === "number"
    ? resumen.totalCotizado
    : articulos.reduce((a, r) => a + (Number(r.unidades)||0) * (Number(r.precioCotizado)||0), 0)

  // Datos para la plantilla
  const data = {
    numero: body.numero ?? "—",
    date: new Date().toLocaleDateString("es-ES"),
    current_year: new Date().getFullYear().toString(),

    // Básicos
    cliente: resumen.cliente ?? body.cliente ?? "—",
    vendedor: body.vendedorNombre || body.vendedor || body.destinatarios?.vendedor || "—",
    tarifa: resumen.tarifa ?? body.tarifa ?? "—",

    // Estado stock / licitación
    stock_disponible: (resumen.stockDisponible ?? body.stockDisponible ?? true) ? "Sí" : "No",
    licitacion: (resumen.licitacion ?? body.licitacion ?? false) ? "Sí" : "No",
    cliente_final: resumen.clienteFinal ?? body.clienteFinal ?? "—",

    // Info adicional
    comprado_antes: resumen.compradoAntes ?? body.compradoAntes ?? false ? "Sí" : "No",
    precio_anterior: resumen.precioAnterior ?? body.precioAnterior ?? "—",
    fecha_decision: resumen.fechaDecision ?? body.fechaDecision ?? "—",
    plazo_entrega: resumen.plazoEntrega ?? body.plazoEntrega ?? "—",
    lugar_entrega: resumen.lugarEntrega ?? body.lugarEntrega ?? "—",
    comentario_stock: resumen.comentarioStock ?? body.comentarioStock ?? "—",
    forma_pago_solicitada: resumen.formaPagoSolicitada ?? body.formaPagoSolicitada ?? "—",
    precio_competencia: resumen.precioCompet ?? body.precioCompet ?? "—",
    comentarios: resumen.comentarios ?? body.comentarios ?? "—",

    // Totales
    total_cotizado: totalCotizado.toFixed(2),
    items: renderItemsTable(articulos),
  }

  // Transporter IONOS (465 SSL)
  const transporter = nodemailer.createTransport({
    host: cfg.mailHost,
    port: Number(cfg.mailPort || 465),
    secure: true,
    auth: { user: cfg.mailUser, pass: cfg.mailPass },
    tls: { minVersion: "TLSv1.2" },
  })

  // Solo destinatarios: vendedor + supervisor
  const vendedorEmail = body.destinatarios?.vendedor ?? body.vendedorEmail ?? null
  const vanessaEmail  = body.destinatarios?.vanessa  ?? "vanessa@comercialav.com"

  const to = [vendedorEmail, vanessaEmail].filter(Boolean).join(", ")
  if (!to) throw createError({ statusCode: 400, statusMessage: "Sin destinatarios 'to' válidos" })

  try {
    const html = await renderTemplate("solicitud-cotizacion.html", data)

    await transporter.sendMail({
      from: `"Cotizaciones Comercial AV" <${cfg.mailUser}>`,
      to,
      subject: `Solicitud de cotización #${data.numero}`,
      html,
    })

    return { ok: true }
  } catch (err: any) {
    console.error("[notify] Error:", err)
    throw createError({ statusCode: 500, statusMessage: "Error enviando correo", data: err?.message })
  }
})

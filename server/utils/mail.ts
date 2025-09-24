// filepath: server/utils/mail.ts
import { promises as fs } from "fs"
import path from "path"
import nodemailer from "nodemailer"

/* ===========================
 * Helpers de plantillas
 * =========================== */

function getDeep(obj: any, dottedKey: string) {
  return dottedKey.split(".").reduce((acc: any, k: string) => acc?.[k], obj)
}

/** Renderiza una plantilla HTML sustituyendo {placeholders}. Soporta claves con punto. */
export async function renderTemplate(templateName: string, data: Record<string, any>) {
  const templatePath = path.resolve("server/mail-templates", templateName)
  console.group(`[MAIL] renderTemplate("${templateName}")`)
  console.log('[MAIL] templatePath:', templatePath)
  let html = await fs.readFile(templatePath, "utf-8")
  console.log('[MAIL] template size (chars):', html?.length ?? 0)

  html = html.replace(/{([\w.]+)}/g, (_m, key) => {
    const val = getDeep(data, key)
    return (val === undefined || val === null) ? "" : String(val)
  })

  console.log('[MAIL] rendered size (chars):', html?.length ?? 0)
  console.groupEnd()
  return html
}

/** Genera tabla sencilla (solicitud de cotización) */
export function renderItemsTable(articulos: Array<any>) {
  return tableBase(
    (a) => ({
      cols: [
        itemCol(a),
        num(a.unidades),
        eur(a.precioCliente),
        eur(a.precioSolicitado),
        eur((Number(a.unidades||0) * Number(a.precioSolicitado||0))),
      ],
      strongIdx: [4],
    }),
    ["Artículo", "Unid.", "Precio cliente", "Precio solicitado", "Total"]
  )
}

// server/utils/mail.ts
export function renderCotizadaTable(articulos: any[] = []) {
  const th = (t:string)=>`<th align="right" style="padding:8px 6px;border-bottom:1px solid #eeeef0;">${t}</th>`
  const td = (v:string, right=true)=>`<td ${right?'align="right"':''} style="padding:8px 6px;border-bottom:1px solid #eeeef0;">${v}</td>`
  const rows = (articulos||[]).map(a=>{
    const u = Number(a.unidades||0)
    const pTar = Number(a.precioCliente||0)
    const pSol = a.precioSolicitado!=null ? Number(a.precioSolicitado) : null
    const pComp= a.precioCompetencia!=null ? Number(a.precioCompetencia) : null
    const pCot = a.precioCotizado!=null ? Number(a.precioCotizado) : null
    return `
    <tr>
      <td style="padding:8px 6px;border-bottom:1px solid #eeeef0;">
        <div style="font-weight:bold;color:#191919">${a.articulo ?? "—"}</div>
        ${a.url ? `<div><a href="${a.url}" target="_blank" style="color:#3c9ae0;text-decoration:underline">${a.url}</a></div>` : ""}
      </td>
      ${td(String(u))}
      ${td(`€ ${pTar.toFixed(2)}`)}
      ${td(pSol!=null ? `€ ${pSol.toFixed(2)}` : "—")}
      ${td(pComp!=null ? `€ ${pComp.toFixed(2)}` : "—")}
      ${td(pCot!=null ? `€ ${pCot.toFixed(2)}` : "—")}
      ${td(`€ ${(u*pTar).toFixed(2)}`)}
      ${td(pCot!=null ? `€ ${(u*pCot).toFixed(2)}` : "—")}
    </tr>`
  }).join("")
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;">
    <thead>
      <tr style="color:#666;">
        <th align="left"  style="padding:8px 6px;border-bottom:1px solid #eeeef0;">Artículo</th>
        ${th('Unid.')}
        ${th('Tarifa')}
        ${th('Solicitado')}
        ${th('Competencia')}
        ${th('Cotizado')}
        ${th('Total (tarifa)')}
        ${th('Total (cotizado)')}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
}


/* ===========================
 * Envío de email (SMTP)
 * =========================== */

let _transport: nodemailer.Transporter | null = null
let _verified = false

function mask(val?: string | null) {
  if (!val) return ''
  if (val.length <= 4) return '****'
  return `${val.slice(0,2)}****${val.slice(-2)}`
}

function envSummary() {
  const host = process.env.MAIL_HOST
  const port = process.env.MAIL_PORT
  const user = process.env.MAIL_USER
  const from = process.env.MAIL_FROM
  return {
    MAIL_HOST: host || '(unset)',
    MAIL_PORT: port || '(unset)',
    MAIL_USER: mask(user || ''),
    MAIL_FROM: from || '(unset)',
    HAS_PASS: Boolean(process.env.MAIL_PASS),
  }
}

function getTransport() {
  if (_transport) return _transport
  const host = process.env.MAIL_HOST || "MAIL.gmail.com"
  const port = Number(process.env.MAIL_PORT || 587)
  const secure = port === 465
  const user = process.env.MAIL_USER
  const pass = process.env.MAIL_PASS
  const debug = String(process.env.MAIL_DEBUG || '').toLowerCase() === 'true'

  console.group('[MAIL] Creating transporter')
  console.log('[MAIL] ENV summary:', envSummary())
  console.log('[MAIL] Using host:', host, 'port:', port, 'secure:', secure)
  console.groupEnd()

  _transport = nodemailer.createTransport({
    host, port, secure,
    auth: user && pass ? { user, pass } : undefined,
    logger: debug,
    debug,
  })
  return _transport
}

export async function sendMail(opts: {
  to: string | string[],
  subject: string,
  html: string,
  cc?: string | string[] | undefined,
  bcc?: string | string[] | undefined,
  replyTo?: string | undefined
}) {
  const from = process.env.MAIL_FROM || process.env.MAIL_USER || "no-reply@example.com"
  const replyTo = opts.replyTo || process.env.MAIL_REPLY_TO || undefined

  const transporter = getTransport()

  // verify una vez por proceso
  if (!_verified) {
    console.time('[MAIL] transporter.verify')
    try {
      await transporter.verify()
      _verified = true
      console.log('[MAIL] transporter.verify: OK')
    } catch (e) {
      console.error('[MAIL] transporter.verify: ERROR', e)
      // seguimos igualmente: algunos servidores no soportan verify pero envían igual
    } finally {
      console.timeEnd('[MAIL] transporter.verify')
    }
  }

  console.group('[MAIL] sendMail()')
  console.log('[MAIL] From:', from)
  console.log('[MAIL] To:', Array.isArray(opts.to) ? opts.to.join(', ') : opts.to)
  if (opts.cc) console.log('[MAIL] Cc:', Array.isArray(opts.cc) ? opts.cc.join(', ') : opts.cc)
  if (opts.bcc) console.log('[MAIL] Bcc:', Array.isArray(opts.bcc) ? opts.bcc.join(', ') : opts.bcc)
  console.log('[MAIL] Subject:', opts.subject)
  console.log('[MAIL] HTML length:', opts.html?.length ?? 0)
  if (replyTo) console.log('[MAIL] Reply-To:', replyTo)

  console.time('[MAIL] transporter.sendMail')
  try {
    const info = await transporter.sendMail({
      from,
      to: opts.to,
      cc: opts.cc,
      bcc: opts.bcc,
      subject: opts.subject,
      html: opts.html,
      replyTo,
    })
    console.timeEnd('[MAIL] transporter.sendMail')
    console.log('[MAIL] MessageId:', info?.messageId)
    console.log('[MAIL] Accepted:', info?.accepted)
    console.log('[MAIL] Rejected:', info?.rejected)
    console.groupEnd()
    return info
  } catch (e) {
    console.timeEnd('[MAIL] transporter.sendMail')
    console.error('[MAIL] sendMail ERROR:', e)
    console.groupEnd()
    throw e
  }
}



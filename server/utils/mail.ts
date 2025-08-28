// filepath: server/utils/mail.ts
import { promises as fs } from "fs"
import path from "path"

function getDeep(obj: any, dottedKey: string) {
  return dottedKey.split(".").reduce((acc, k) => (acc?.[k]), obj)
}

/** Renderiza una plantilla HTML sustituyendo {placeholders}. Soporta claves con punto. */
export async function renderTemplate(templateName: string, data: Record<string, any>) {
  const templatePath = path.resolve("server/mail-templates", templateName)
  let html = await fs.readFile(templatePath, "utf-8")

  html = html.replace(/{([\w.]+)}/g, (_m, key) => {
    const val = getDeep(data, key)
    return (val === undefined || val === null) ? "" : String(val)
  })

  return html
}

/** Genera el bloque HTML de items (artículos) con estilo email-friendly */
export function renderItemsTable(articulos: Array<any>) {
  const rows = (articulos || []).map(a => `
    <tr>
      <td style="padding:8px 6px; border-bottom:1px solid #eeeef0;">
        <div style="font-weight:bold;color:#191919">${a.articulo ?? "—"}</div>
        ${a.url ? `<div><a href="${a.url}" style="color:#3c9ae0;text-decoration:underline" target="_blank">${a.url}</a></div>` : ""}
      </td>
      <td align="right" style="padding:8px 6px; border-bottom:1px solid #eeeef0;">${a.unidades ?? 0}</td>
      <td align="right" style="padding:8px 6px; border-bottom:1px solid #eeeef0;">€ ${(Number(a.precioCliente||0)).toFixed(2)}</td>
      <td align="right" style="padding:8px 6px; border-bottom:1px solid #eeeef0;">€ ${(Number(a.precioCotizado||0)).toFixed(2)}</td>
      <td align="right" style="padding:8px 6px; border-bottom:1px solid #eeeef0; font-weight:600;">
        € ${((Number(a.unidades||0) * Number(a.precioCotizado||0))).toFixed(2)}
      </td>
    </tr>
  `).join("")

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;">
      <thead>
        <tr style="color:#666; text-align:center;">
          <th align="left"  style="padding:8px 6px; border-bottom:1px solid #eeeef0;">Artículo</th>
          <th align="right" style="padding:8px 6px; border-bottom:1px solid #eeeef0;">Unid.</th>
          <th align="right" style="padding:8px 6px; border-bottom:1px solid #eeeef0;">Precio cliente</th>
          <th align="right" style="padding:8px 6px; border-bottom:1px solid #eeeef0;">Precio cotizado</th>
          <th align="right" style="padding:8px 6px; border-bottom:1px solid #eeeef0;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
}

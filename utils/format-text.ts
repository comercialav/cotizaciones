import DOMPurify from 'dompurify'

const HTML_LIKE = /<(?:br|p|div|ul|ol|li|strong|b|em|i|u|span|a|h[1-6]|table|tr|td|th)\b[^>]*>/i

const SPEC_KEYWORDS =
  /\s+(?=(?:DISCO|FUENTE|MEMORIA|PROCESADOR|PLACA|TARJETA|CAJA|REFRIGERACI[ÓO]N|MONITOR|TECLADO|RAT[ÓO]N|ALTAVOZ|CABLE|ADAPTADOR|ORDENADOR|GR[ÁA]FICA|SSD|HDD|RAM|CPU|GPU)\b)/gi

const RICH_TEXT_PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'span', 'div',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'a',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col',
  ],
  ALLOWED_ATTR: [
    'href', 'target', 'rel', 'title',
    'style', 'class',
    'colspan', 'rowspan', 'width', 'height', 'align', 'valign', 'bgcolor',
    'border', 'cellpadding', 'cellspacing',
  ],
  ALLOW_DATA_ATTR: false,
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function looksLikeHtml(text: string): boolean {
  return HTML_LIKE.test(text || '')
}

/** True si el HTML enriquecido no tiene texto visible (p. ej. `<p><br></p>`) */
export function isRichTextEmpty(html?: string | null): boolean {
  const raw = String(html || '')
  const text = raw
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u200b/g, '')
    .trim()
  return !text
}

/** Convierte HTML pegado de correo a texto plano con saltos de línea */
export function htmlToPlainText(html: string): string {
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')

  out = decodeBasicEntities(out)
  out = out.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  out = out.replace(/\n{3,}/g, '\n\n')
  return out.trim()
}

/** Separa bloques densos (copiados sin saltos) en líneas más legibles */
export function splitDenseSpecText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return trimmed

  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length > 2) return trimmed

  let working = trimmed.replace(/\s·\s/g, '\n')

  if (!working.includes('\n') && working.length > 120) {
    working = working.replace(SPEC_KEYWORDS, '\n')
  }

  return working
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n')
}

export function normalizePlainText(text: string): string {
  return splitDenseSpecText(
    decodeBasicEntities(String(text || ''))
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .trim(),
  )
}

function sanitizeAllowedHtmlFallback(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(\/?)(?!br|p|ul|ol|li|strong|b|em|i|u|a\b|table|thead|tbody|tr|td|th|h[1-6]|span|div)[a-z0-9-]+[^>]*>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

export function sanitizeRichHtml(html: string): string {
  const raw = String(html || '').trim()
  if (!raw) return ''

  if (import.meta.server) {
    return sanitizeAllowedHtmlFallback(raw)
  }

  return DOMPurify.sanitize(raw, RICH_TEXT_PURIFY_CONFIG)
}

function linkifyEscaped(text: string): string {
  return text.replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)])/gi,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  )
}

/** HTML seguro para mostrar notas / comentarios con formato legible */
export function formatTextForDisplay(text: string): string {
  const raw = String(text || '').trim()
  if (!raw) return ''

  if (looksLikeHtml(raw)) {
    return sanitizeRichHtml(raw)
  }

  const normalized = normalizePlainText(raw)
  return linkifyEscaped(
    escapeHtml(normalized).replace(/\n/g, '<br>'),
  )
}

/** Normaliza texto pegado en un textarea (desde correo, Word, etc.) */
export function normalizePastedText(raw: string, html?: string | null): string {
  const source = html?.trim() ? htmlToPlainText(html) : raw
  return normalizePlainText(source)
}

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  collection, doc, onSnapshot, addDoc, updateDoc, getDocs, query, where, serverTimestamp
} from 'firebase/firestore'
import { useUserStore } from '~/stores/user'
import {
  normalizeStockEstado, stockEstadoLabel, stockChipColor, stockNeedsCompras,
  pendienteStripState, comprasHaRespondido, comprasRespondioEnChat, cotizacionAbierta,
} from '~/utils/stock'
import { formatComentarioNotifText } from '~/utils/notificaciones'
import { cotizacionCompradoAntes, articuloLabel, buildArticuloIdentidad, hydrateArticuloIdentidad } from '~/utils/articulos'
import { tarifaLabel } from '~/utils/tarifas'
import { tipoEntregaLabel } from '~/utils/entrega'
import { workflowLabel, workflowBadgeColor, comercialHaRespondidoEspera, comercialRespondioEnChat, comentarioEsRespuestaComercial } from '~/utils/workflow'
import { pickRandomGif } from '~/utils/resultado-gifs'
import { filterComercialesList } from '~/utils/comerciales'
import {
  buildParticipanteUids,
  buildParticipanteEmails,
  canViewCotizacion,
  cotizacionComercialEmails,
  isCotizacionOwner,
  isCotizacionParticipant,
  puedeActuarComercialEnCotizacion,
  participantesOf,
} from '~/utils/cotizacion-access'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'

definePageMeta({ middleware: ['role-comercial'] })

const { $db, $storage, $auth } = useNuxtApp()
const route = useRoute()
const user = useUserStore()

const id = computed(() => String(route.params.id))
const loading = ref(true)
const cot = ref<any | null>(null)
const comments = ref<any[]>([])
const newComment = ref('')
const fileToUpload = ref<File|null>(null)
const chatFileInput = ref<HTMLInputElement | null>(null)
const commentUploading = ref(false)
const chatUploadError = ref('')
const attachments = ref<any[]>([])
const detailTab = ref<'detalles' | 'articulos' | 'notas' | 'actividad' | 'adjuntos'>('articulos')

const MAX_CHAT_FILE = 10 * 1024 * 1024

const SUPERVISOR_ROLE = 'jefe_comercial'
const supervisorEmail = ref<string|null>(null)

const dlgConfirmacionCompra = ref(false);  // Dialogo para confirmar compra
const articulosComprados = ref<any[]>([]);  // Artículos seleccionados como comprados
const comentarios = ref('');  // Comentarios adicionales

const selectedArticulo = ref<string | null>(null) // Artículo seleccionado para el comentario
const commentVisibility = ref<'publico' | 'privado'>('publico') // Visibilidad del comentario
const showVisibilityDialog = ref(false);

async function loadSupervisor() {
  const q1 = query(collection($db, 'usuarios'), where('rol', '==', SUPERVISOR_ROLE))
  const s1 = await getDocs(q1)
  if (s1.docs.length) { supervisorEmail.value = s1.docs[0].data().email || null; return }

  const q2 = query(collection($db, 'usuarios'), where('esSupervisor', '==', true))
  const s2 = await getDocs(q2)
  supervisorEmail.value = s2.docs[0]?.data()?.email || 'vanessa@comercialav.com'
}

const showReassign = ref(false)
const comerciales = ref<any[]>([])
const seleccionado = ref<any|null>(null)
const showParticipantes = ref(false)
const participanteSeleccionado = ref<any|null>(null)
const participantesSaving = ref(false)
const esTemporal = ref(false)
const fechaDesde = ref<string>(new Date().toISOString().slice(0,10))
const fechaHasta = ref<string>('')

const canConfirmReassign = computed(() =>
  !!seleccionado.value &&
  (!esTemporal.value || (fechaHasta.value && fechaHasta.value >= fechaDesde.value))
)

function tsToDate(ts: any) {
  if (!ts) return null
  return ts?.toDate?.() ? ts.toDate() : new Date(ts)
}
function fmt(ts: any) {
  const d = tsToDate(ts)
  if (!d) return '—'
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}
function initials(name: string) {
  if (!name) return '—'
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('')
}
function colorByRol(rol?: string) {
  const rn = (rol || '').toLowerCase()
  if (rn === 'comercial') return 'primary'
  if (rn === 'admin') return 'indigo'
  if (rn === 'compras') return 'teal'
  if (rn.includes('vanes')) return 'deep-orange'
  return 'secondary'
}
function estadoChip(e?: string) {
  const k = (e || 'pendiente').toLowerCase()
  if (k === 'resuelta') return { text: 'Resuelta', color: 'success' }
  if (k === 'reabierta') return { text: 'Reabierta', color: 'primary' }
  return { text: 'Pendiente', color: 'warning' }
}
function sumLineas(art:any[], field:'precioCliente'|'precioSolicitado'){
  return (art || []).reduce((a,r)=> a + (Number(r.unidades)||0)*(Number(r[field]||0)||0), 0)
}
function descuentoPct(tarifa: number, cotizado: number): number | null {
  const t = Number(tarifa) || 0
  const c = Number(cotizado) || 0
  if (t <= 0) return null
  return ((t - c) / t) * 100
}
function descuentoLinea(a: any): number | null {
  if (a.precioCotizado == null) return null
  const tarifa = (Number(a.unidades) || 0) * (Number(a.precioCliente) || 0)
  const cotizado = (Number(a.unidades) || 0) * (Number(a.precioCotizado) || 0)
  return descuentoPct(tarifa, cotizado)
}
function getCounterpartyEmail(): string | null {
  const role = (user.rol || '').toLowerCase()
  const isSup = role === SUPERVISOR_ROLE || role.includes('vanes') || (user as any).esSupervisor === true
  if (isSup) return cot.value?.vendedor?.email || null
  if (role === 'comercial' || user.uid === cot.value?.vendedor?.uid) return supervisorEmail.value
  return cot.value?.vendedor?.email || supervisorEmail.value || null
}
const totalCotizado = computed(() => sumLineas(cot.value?.articulos || [], 'precioCliente'))
const totalPrecioCotizado = computed(() => {
  const arts = cot.value?.articulos || []
  if (!arts.some((a: any) => a.precioCotizado != null)) return null
  return arts.reduce((acc: number, a: any) =>
    acc + (Number(a.unidades) || 0) * (Number(a.precioCotizado) || 0), 0)
})
const descuentoGlobal = computed(() => {
  if (totalPrecioCotizado.value == null) return null
  return descuentoPct(totalCotizado.value, totalPrecioCotizado.value)
})

const isSupervisor = computed(() => {
  const r = (user.rol || '').toLowerCase()
  return r === 'admin' || r === 'jefe_comercial' || r.includes('vanes')
})
const canElegirVisibilidadComentario = computed(() =>
  isSupervisor.value || user.isCompras || actorEsCompras(),
)
const visibilityDialogText = computed(() => {
  if (user.isCompras || actorEsCompras()) {
    return fileToUpload.value
      ? '¿El adjunto y el comentario los publicas para todos o solo para la supervisora?'
      : '¿Lo publicas para todos o solo para la supervisora?'
  }
  return fileToUpload.value
    ? '¿El adjunto y el comentario los publicas para todos o solo para compras?'
    : '¿Lo publicas para todos o solo para compras?'
})
const visibilityPublicoLabel = computed(() => 'Público')
const visibilityPrivadoLabel = computed(() =>
  (user.isCompras || actorEsCompras()) ? 'Solo supervisora' : 'Privado',
)
const puedeAdjuntarEnChat = computed(() =>
  isSupervisor.value || user.isCompras || actorEsCompras() || isParticipant.value,
)
// --- roles/estados para bloquear tras cotizar ---
const isComercial = computed(() => (user.rol || '').toLowerCase() === 'comercial')
const isCotizada  = computed(() => (cot.value?.workflow || '').toLowerCase() === 'cotizado')
const isGanada    = computed(() => (cot.value?.estado || '').toLowerCase() === 'ganada')
const tieneNotas  = computed(() => !!(cot.value?.comentarioStock || cot.value?.comentariosCliente))
const isPerdida   = computed(() => (cot.value?.estado || '').toLowerCase() === 'perdida')
const isAplazada  = computed(() => (cot.value?.estado || '').toLowerCase() === 'aplazada')

const isOwner = computed(() => isCotizacionOwner(user.uid, cot.value, user.email))
const isParticipant = computed(() => puedeActuarComercialEnCotizacion(user, cot.value))
const isSoloParticipante = computed(() => isParticipant.value && !isOwner.value)
const participantesActuales = computed(() => participantesOf(cot.value))
const comercialesParaParticipante = computed(() => {
  const uids = new Set(participanteUidsLocales.value)
  return comerciales.value.filter(c => c.uid && !uids.has(c.uid))
})
const participanteUidsLocales = computed(() => buildParticipanteUids(cot.value?.vendedor?.uid, participantesActuales.value))
const puedeAccionar = computed(() => isSupervisor.value)
const cotStockEstado = computed(() => normalizeStockEstado(cot.value))
const cotStockLabel = computed(() => stockEstadoLabel(cotStockEstado.value))
const cotStockColor = computed(() => stockChipColor(cotStockEstado.value))
const cotPendienteStrip = computed(() => {
  if (!user.canVerPendienteCompras) return null
  return pendienteStripState(cot.value, { forCompras: user.isCompras, comments: comments.value })
})

function destinatariosComercial() {
  return cotizacionComercialEmails(cot.value)
}

function cotizacionLink() {
  if (import.meta.client) {
    return `${window.location.origin}/cotizaciones/${id.value}`
  }
  return `/cotizaciones/${id.value}`
}

function actorEsCompras() {
  return user.isCompras || (user.rol || '').toLowerCase() === 'compras'
}

async function marcarComprasAtendido(extra?: { uid?: string | null; nombre?: string | null; rol?: string | null; email?: string | null }) {
  if (!actorEsCompras() && !extra) return
  if (comprasHaRespondido(cot.value)) return
  await updateDoc(doc($db, 'cotizaciones', id.value), {
    comprasAtendidoAt: serverTimestamp(),
    comprasRespondio: true,
    comprasAtendidoPor: {
      uid: extra?.uid ?? user.uid,
      nombre: extra?.nombre ?? user.nombre,
      email: extra?.email ?? user.email,
      rol: extra?.rol ?? user.rol ?? 'compras',
    },
    updatedAt: serverTimestamp(),
  })
}

let backfillComprasAtendidoInFlight = false
watch(
  [cot, comments],
  async () => {
    if (!cot.value || backfillComprasAtendidoInFlight) return
    if (!cotizacionAbierta(cot.value)) return
    if (!stockNeedsCompras(normalizeStockEstado(cot.value))) return
    if (comprasHaRespondido(cot.value)) return
    if (!comprasRespondioEnChat(comments.value)) return

    const ultimo = [...comments.value]
      .reverse()
      .find(c => (c.author?.rol || '').toLowerCase() === 'compras' || String(c.author?.email || '').toLowerCase() === 'compras@comercialav.com')

    backfillComprasAtendidoInFlight = true
    try {
      await marcarComprasAtendido(ultimo?.author ? {
        uid: ultimo.author.uid,
        nombre: ultimo.author.nombre,
        rol: ultimo.author.rol,
        email: ultimo.author.email,
      } : { rol: 'compras', nombre: 'Compras' })
    } catch (e) {
      console.error('[COMPRAS] backfill comprasAtendidoAt', e)
    } finally {
      backfillComprasAtendidoInFlight = false
    }
  },
  { immediate: true },
)

async function marcarComercialRespondioEspera(extra?: {
  uid?: string | null
  nombre?: string | null
  rol?: string | null
  email?: string | null
}) {
  if (!cot.value) return
  if ((cot.value.workflow || '').toLowerCase() !== 'espera_comercial') return
  if (comercialHaRespondidoEspera(cot.value)) return
  await updateDoc(doc($db, 'cotizaciones', id.value), {
    comercialRespondioAt: serverTimestamp(),
    comercialRespondio: true,
    comercialRespondidoPor: {
      uid: extra?.uid ?? user.uid,
      nombre: extra?.nombre ?? user.nombre,
      email: extra?.email ?? user.email,
      rol: extra?.rol ?? user.rol ?? 'comercial',
    },
    workflow: 'en_revision',
    updatedAt: serverTimestamp(),
  })
}

let backfillComercialRespondioInFlight = false
watch(
  [cot, comments],
  async () => {
    if (!cot.value || backfillComercialRespondioInFlight) return
    if (!cotizacionAbierta(cot.value)) return
    if ((cot.value.workflow || '').toLowerCase() !== 'espera_comercial') return
    if (comercialHaRespondidoEspera(cot.value)) return
    if (!comercialRespondioEnChat(comments.value, cot.value)) return

    const ultimo = [...comments.value]
      .reverse()
      .find(c => comentarioEsRespuestaComercial(c, cot.value))

    backfillComercialRespondioInFlight = true
    try {
      await marcarComercialRespondioEspera(ultimo?.author ? {
        uid: ultimo.author.uid,
        nombre: ultimo.author.nombre,
        rol: ultimo.author.rol,
        email: ultimo.author.email,
      } : undefined)
    } catch (e) {
      console.error('[COMERCIAL] backfill comercialRespondioAt', e)
    } finally {
      backfillComercialRespondioInFlight = false
    }
  },
  { immediate: true },
)
const canEditArticulos = computed(() =>
  user.isCompras && !isCotizada.value && !isGanada.value && !isPerdida.value && !isAplazada.value
)
const canEditComercialFull = computed(() =>
  isParticipant.value && !isSupervisor.value && !user.isCompras
  && !isCotizada.value && !isGanada.value && !isPerdida.value && !isAplazada.value
)
const canEditarPrecioCotizado = computed(() => user.canCotizar && !isGanada.value && !isPerdida.value && !isAplazada.value)
const canEditFull = computed(() =>
  (isSupervisor.value || canEditComercialFull.value) && !isCotizada.value && !isGanada.value && !isPerdida.value && !isAplazada.value
)
function canSet(flow: 'en_revision'|'consultando'|'consultando_compras'|'espera_cliente'|'espera_comercial') {
  if (flow === 'espera_cliente') return Boolean(isParticipant.value)
  if (flow === 'espera_comercial') return Boolean(isSupervisor.value)
  return Boolean(isSupervisor.value)
}

// ---- helpers auth para Storage ----
async function ensureAuth() {
  if ($auth.currentUser) return
  const { signInAnonymously } = await import('firebase/auth')
  await signInAnonymously($auth)
}

function fmtDateStr(s?: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(d)
}
function fmtMoney(n?: number | null) {
  const v = Number(n ?? 0)
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
}

function lineaCompradoAntes(a: any, i: number) {
  if (a.compradoAntes) return true
  if (i === 0 && cot.value?.compradoAntes && a.compradoAntes == null) return true
  return false
}

function lineaPrecioAnterior(a: any, i: number): number | null {
  if (a.compradoAntes || a.precioAnterior != null) {
    return a.precioAnterior != null ? Number(a.precioAnterior) : null
  }
  if (i === 0 && cot.value?.compradoAntes && cot.value?.precioAnterior != null) {
    return Number(cot.value.precioAnterior)
  }
  return null
}

function lineaTieneExtras(a: any, i: number) {
  return (
    a.precioSolicitado != null
    || a.precioCompetencia != null
    || lineaCompradoAntes(a, i)
  )
}


// Snapshots
let stopDoc: null | (() => void) = null
let stopComments: null | (() => void) = null
let stopAdjuntos: null | (() => void) = null 

onMounted(() => {
  stopDoc = onSnapshot(doc($db, 'cotizaciones', id.value), (snap) => {
    loading.value = false
    cot.value = snap.exists() ? { id: snap.id, ...snap.data() } : null
  })
  stopComments = onSnapshot(collection($db, 'cotizaciones', id.value, 'comentarios'), (qs) => {
    comments.value = qs.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a:any,b:any)=> (b.fecha?.seconds||0) - (a.fecha?.seconds||0))
  })
  stopAdjuntos = onSnapshot(
    collection($db, 'cotizaciones', id.value, 'adjuntos'),
    (qs) => {
      attachments.value = qs.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a:any,b:any)=> (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0))
    }
  )

  loadSupervisor().catch(console.error)
})

let backfillParticipantesInFlight = false
watch(cot, async (c) => {
  if (!c || loading.value) return
  if (!canViewCotizacion(user, c)) {
    navigateTo('/cotizaciones')
    return
  }
  const vendedorUid = c.vendedor?.uid || c.vendedorUid
  if (!vendedorUid || backfillParticipantesInFlight) return
  const expected = buildParticipanteUids(vendedorUid, participantesOf(c))
  const expectedEmails = buildParticipanteEmails(participantesOf(c))
  const current = Array.isArray(c.participanteUids) ? c.participanteUids : []
  const currentEmails = Array.isArray(c.participanteEmails) ? c.participanteEmails : []
  const missingUids = expected.some(uid => !current.includes(uid))
  const missingEmails = expectedEmails.some(e => !currentEmails.includes(e))
  if (!missingUids && !missingEmails && Array.isArray(c.participantes)) return

  backfillParticipantesInFlight = true
  try {
    await updateDoc(doc($db, 'cotizaciones', id.value), {
      participanteUids: expected,
      participanteEmails: expectedEmails,
      participantes: Array.isArray(c.participantes) ? c.participantes : [],
    })
  } catch (e) {
    console.error('[PARTICIPANTES] backfill', e)
  } finally {
    backfillParticipantesInFlight = false
  }
}, { immediate: true })
onUnmounted(() => { 
  stopDoc?.(); stopComments?.() 
  stopAdjuntos?.()
})

// ===== Slack via Nuxt server API =====
async function notifySlack(text: string, event: string, toEmailOverride?: string | null | string[]) {
  try {
    const emails = new Set<string>()
    if (Array.isArray(toEmailOverride)) {
      for (const e of toEmailOverride) if (e) emails.add(e)
    } else if (toEmailOverride) {
      emails.add(toEmailOverride)
    } else {
      const counterparty = getCounterpartyEmail()
      if (counterparty) emails.add(counterparty)
      for (const e of destinatariosComercial()) emails.add(e)
    }
    const list = [...emails].filter(Boolean)
    if (!list.length) { console.warn('Slack: sin destinatario'); return }
    await $fetch('/api/slack/dm', {
      method: 'POST',
      body: { toEmail: list[0], ccEmails: list.slice(1), text, event },
    })
  } catch (e:any) {
    console.error('Slack DM error:', e?.data || e)
  }
}

// ===== Acciones =====
function setCommentVisibility(visibility: 'publico' | 'privado') {
  commentVisibility.value = visibility;
  showVisibilityDialog.value = false;
  addComment();
}
function onAddCommentClick() {
  if (!newComment.value.trim() && !fileToUpload.value) return
  if (canElegirVisibilidadComentario.value) {
    showVisibilityDialog.value = true
  } else {
    commentVisibility.value = 'publico'
    addComment()
  }
}
async function addComment() {
  const texto = newComment.value.trim();
  if (!texto && !fileToUpload.value) return;

  commentUploading.value = true
  chatUploadError.value = ''

  const visibilidadGuardada = commentVisibility.value
  const articuloGuardado = selectedArticulo.value
  let attachment = null;

  try {
    if (fileToUpload.value) {
      if (import.meta.server) return;
      await ensureAuth();
      const path = `cotizaciones/${id.value}/attachments/${Date.now()}_${fileToUpload.value.name}`;
      const fileRef = storageRef($storage, path);
      await uploadBytes(fileRef, fileToUpload.value);
      const url = await getDownloadURL(fileRef);
      attachment = { nombre: fileToUpload.value.name, url, tipo: fileToUpload.value.type };
    }

    await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
      texto: texto || null,
      attachment,
      visibilidad: visibilidadGuardada,
      articuloId: articuloGuardado,
      tipo: 'comentario',
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol },
    });

    newComment.value = '';
    fileToUpload.value = null;
    if (chatFileInput.value) chatFileInput.value.value = '';
    selectedArticulo.value = null;
    commentVisibility.value = 'publico';

    if (visibilidadGuardada === 'privado') {
      if (isSupervisor.value) {
        try {
          const res = await $fetch<{ ok?: boolean; error?: string; skipped?: boolean }>('/api/notify', {
            method: 'POST',
            body: {
              action: 'comentario_privado',
              comentario: texto,
              articuloId: articuloGuardado,
              cotizacionId: id.value,
              cliente: cot.value?.cliente,
              numero: cot.value?.numero,
              autor: user.nombre,
              destinatarios: {
                compras: 'compras@comercialav.com',
              },
            },
          });
          if (!res?.ok && !res?.skipped) {
            console.error('[CHAT] Email a compras no enviado:', res?.error || res);
          }
        } catch (e: any) {
          console.error('[CHAT] Error enviando email a compras:', e?.data || e);
        }
      } else {
        const msg = formatComentarioNotifText({
          privado: true,
          texto,
          attachment,
          numero: cot.value?.numero,
          cliente: cot.value?.cliente,
          cotizacionId: id.value,
          articulo: articuloGuardado,
        })
        if (!supervisorEmail.value) await loadSupervisor()
        if (user.isCompras || actorEsCompras()) {
          try {
            const res = await $fetch<{ ok?: boolean; error?: string; skipped?: boolean }>('/api/notify', {
              method: 'POST',
              body: {
                action: 'comentario_privado_supervisor',
                comentario: texto || (attachment ? `Archivo adjunto: ${attachment.nombre}` : ''),
                attachmentNombre: attachment?.nombre || null,
                attachmentUrl: attachment?.url || null,
                articuloId: articuloGuardado,
                cotizacionId: id.value,
                cliente: cot.value?.cliente,
                numero: cot.value?.numero,
                autor: user.nombre,
                destinatarios: {
                  supervisor: supervisorEmail.value,
                },
              },
            })
            if (!res?.ok && !res?.skipped) {
              console.error('[CHAT] Email a supervisora no enviado:', res?.error || res)
            }
          } catch (e: any) {
            console.error('[CHAT] Error enviando email a supervisora:', e?.data || e)
          }
        }
        await notifySlack(msg, 'comentario_privado', supervisorEmail.value)
      }
    } else {
      const msg = formatComentarioNotifText({
        autor: user.nombre,
        texto,
        attachment,
        numero: cot.value?.numero,
        cliente: cot.value?.cliente,
        cotizacionId: id.value,
      })
      await notifySlack(msg, 'comentario_publico');
    }

    const patch: Record<string, unknown> = { updatedAt: serverTimestamp() }
    if (actorEsCompras() && !comprasHaRespondido(cot.value)) {
      patch.comprasAtendidoAt = serverTimestamp()
      patch.comprasRespondio = true
      patch.comprasAtendidoPor = {
        uid: user.uid,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol || 'compras',
      }
    }
    if (
      isOwner.value
      && (cot.value?.workflow || '').toLowerCase() === 'espera_comercial'
      && !comercialHaRespondidoEspera(cot.value)
    ) {
      patch.comercialRespondioAt = serverTimestamp()
      patch.comercialRespondio = true
      patch.comercialRespondidoPor = {
        uid: user.uid,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol || 'comercial',
      }
      patch.workflow = 'en_revision'
    }
    await updateDoc(doc($db, 'cotizaciones', id.value), patch)
  } catch (e: any) {
    console.error('[CHAT] Error al publicar comentario:', e)
    chatUploadError.value = e?.message || 'No se pudo enviar el comentario o adjuntar el archivo.'
  } finally {
    commentUploading.value = false
  }
}

// Actividades que contienen datos sensibles de coste/proveedor solo para supervisor/compras
const ACTIVIDAD_SENSIBLE_RE = /precio de coste|proveedor actualizado|coste €|proveedor "/i

const filteredComments = computed(() => {
  return comments.value.filter(c => {
    if (c.tipo === 'actividad') {
      // Ocultar a comerciales las actividades con datos de coste o proveedor
      if (!isSupervisor.value && !user.isCompras) {
        if (c.visibilidad === 'privado') return false
        if (ACTIVIDAD_SENSIBLE_RE.test(String(c.texto || ''))) return false
      }
      return true
    }
    const vis = c.visibilidad || 'publico'
    if (vis === 'publico') return true
    if (vis === 'privado') {
      return isSupervisor.value || user.isCompras
    }
    return isSupervisor.value
  })
})

function commentTs(c: any) {
  return c?.fecha?.seconds || c?.fecha?.toMillis?.() / 1000 || 0
}

function isActivityEntry(c: any) {
  if (c.tipo === 'actividad') return true
  if (c.tipo === 'comentario') return false
  if (c.visibilidad === 'publico' || c.visibilidad === 'privado') return false
  const t = String(c.texto || '').trim()
  if (!t && c.attachment) return true
  if (/^(🔄|🧾|✏️|➕|📎|😔|🔁|🙁|🏆|✅)/.test(t)) return true
  if (/^(Recotización confirmada|Cotización cerrada|Reasignada|marcada como|El comercial ha editado|✏️)/i.test(t)) return true
  if (/actualizado por|solicita recotización|añadió/i.test(t)) return true
  return false
}

function activityMeta(texto: string) {
  const t = String(texto || '')
  if (t.includes('Recotización') || t.startsWith('🔄')) return { icon: 'mdi:refresh', tone: 'blue' }
  if (t.includes('Cotización cerrada') || t.startsWith('🧾')) return { icon: 'mdi:file-certificate', tone: 'green' }
  if (t.includes('actualizado') || t.startsWith('✏️')) return { icon: 'mdi:pencil', tone: 'amber' }
  if (t.includes('añadió') || t.startsWith('➕')) return { icon: 'mdi:plus-circle', tone: 'primary' }
  if (t.includes('adjuntó') || t.startsWith('📎') || t.includes('adjuntado')) return { icon: 'mdi:paperclip', tone: 'slate' }
  if (t.includes('PERDIDA') || t.startsWith('😔') || t.startsWith('🙁')) return { icon: 'mdi:thumb-down', tone: 'red' }
  if (t.includes('GANADA') || t.startsWith('🏆')) return { icon: 'mdi:trophy', tone: 'green' }
  if (t.startsWith('Reasignada') || t.startsWith('🔁')) return { icon: 'mdi:account-switch', tone: 'purple' }
  return { icon: 'mdi:history', tone: 'slate' }
}

const chatComments = computed(() =>
  filteredComments.value
    .filter(c => !isActivityEntry(c))
    .sort((a, b) => commentTs(a) - commentTs(b))
)

const activityTimeline = computed(() => {
  const items: any[] = [{
    id: 'created',
    kind: 'creation',
    icon: 'mdi:file-document-plus-outline',
    tone: 'primary',
    title: `${cot.value?.vendedor?.nombre || 'Vendedor'} creó la cotización`,
    subtitle: `#${cot.value?.numero || '—'} · € ${totalCotizado.value.toFixed(2)}`,
    fecha: cot.value?.fechaCreacion || cot.value?.fecha,
  }]

  for (const c of filteredComments.value) {
    if (!isActivityEntry(c)) continue
    const texto = c.texto || (c.attachment ? `Adjuntó “${c.attachment.nombre}”` : 'Actividad')
    const meta = activityMeta(texto)
    items.push({
      id: c.id,
      kind: 'log',
      icon: meta.icon,
      tone: meta.tone,
      title: texto.replace(/\*\*/g, ''),
      subtitle: c.author?.nombre ? `Por ${c.author.nombre}` : '',
      fecha: c.fecha,
    })
  }

  return items.sort((a, b) => commentTs(b) - commentTs(a))
})



async function setWorkflow(flow: 'en_revision'|'consultando'|'consultando_compras'|'espera_cliente'|'espera_comercial') {
  if (!cot.value) return
  await updateDoc(doc($db, 'cotizaciones', id.value), { workflow: flow, updatedAt: serverTimestamp() })
  const msg = `🔄 ${user.nombre} cambió el estado de la cotización “${cot.value?.cliente || id.value}” a *${workflowLabel(flow)}*.`
  if (flow === 'consultando' || flow === 'consultando_compras') {
    await notifySlack(msg, 'workflow', 'compras@comercialav.com')
  }
  if (flow === 'espera_comercial' || isSupervisor.value) await notifySlack(msg, 'workflow', destinatariosComercial())
  else if (flow === 'espera_cliente') await notifySlack(msg, 'workflow', supervisorEmail.value)
}

async function aceptar() {
  if (!cot.value) return
  await updateDoc(doc($db, 'cotizaciones', id.value), { estado: 'resuelta', updatedAt: serverTimestamp() })
  const msg = `✅ ${user.nombre} marcó la cotización “${cot.value?.cliente || id.value}” como *ACEPTADA*.`
  if (destinatariosComercial().length) await notifySlack(msg, 'workflow', destinatariosComercial())
  if (supervisorEmail.value) await notifySlack(msg, 'workflow', supervisorEmail.value)
}

async function loadComerciales() {
  try {
    const qRef = query(collection($db, 'usuarios'), where('rol', 'in', ['comercial', 'Comercial']))
    const snap = await getDocs(qRef)
    const lista = snap.docs.map(d => {
      const data = d.data()
      const authUid = data.authUid || d.id
      const legacyUid = data.uid && data.uid !== authUid ? data.uid : null
      return {
        id: d.id,
        uid: authUid,
        authUid,
        legacyUid,
        nombre: data.nombre || data.displayName || data.email || 'Sin nombre',
        email: data.email || null,
        rol: data.rol || 'comercial'
      }
    })
    const exclude = new Set<string>([
      cot.value?.vendedor?.uid,
      ...participantesActuales.value.map(p => p.uid),
    ].filter(Boolean) as string[])
    comerciales.value = filterComercialesList(
      lista.filter((u: any) => u.uid && !exclude.has(u.uid)),
    )
  } catch (e) {
    console.error('[reasignar] Error cargando comerciales', e)
    comerciales.value = []
  }
}

async function abrirParticipantes() {
  if (!comerciales.value.length) await loadComerciales()
  participanteSeleccionado.value = null
  showParticipantes.value = true
}

async function confirmarParticipante() {
  if (!participanteSeleccionado.value || !cot.value || !user.canGestionarParticipantes) return
  participantesSaving.value = true
  try {
    const comercial = participanteSeleccionado.value
    const vendedorUid = cot.value.vendedor?.uid
    if (!comercial.uid || comercial.uid === vendedorUid) return
    if (participantesActuales.value.some(p => p.uid === comercial.uid)) return

    const participantes = [
      ...participantesActuales.value,
      {
        uid: comercial.uid,
        nombre: comercial.nombre || null,
        email: comercial.email || null,
        rol: comercial.rol || 'comercial',
        addedAt: new Date().toISOString(),
        addedBy: { uid: user.uid, nombre: user.nombre },
      },
    ]
    const extraUids = [
      comercial.uid,
      comercial.id,
      comercial.authUid,
      comercial.legacyUid,
    ].filter(Boolean).map(String)
    const participanteUids = [
      ...new Set([...buildParticipanteUids(vendedorUid, participantes), ...extraUids]),
    ]
    const participanteEmails = buildParticipanteEmails(participantes)

    await updateDoc(doc($db, 'cotizaciones', id.value), {
      participantes,
      participanteUids,
      participanteEmails,
      updatedAt: serverTimestamp(),
    })

    const texto = `➕ ${user.nombre} añadió a ${comercial.nombre} como participante.`
    await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
      texto,
      tipo: 'actividad',
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol },
    })

    showParticipantes.value = false
    participanteSeleccionado.value = null
    await loadComerciales()

    // Notificaciones en segundo plano (no bloquear si el SMTP falla)
    const ref = `#${cot.value.numero || id.value} – ${cot.value.cliente || '—'}`
    const slackMsg = `👥 ${user.nombre} te añadió como participante en la cotización ${ref}.`
    if (comercial.email) {
      notifySlack(slackMsg, 'participante_anadido', [comercial.email]).catch(console.error)
      $fetch('/api/notify', {
        method: 'POST',
        body: {
          action: 'participante_anadido',
          numero: cot.value.numero,
          cliente: cot.value.cliente,
          autor: user.nombre,
          link: cotizacionLink(),
          destinatarios: { comercial: comercial.email },
        },
      }).catch(console.error)
    }
  } catch (e) {
    console.error('[PARTICIPANTES] añadir', e)
  } finally {
    participantesSaving.value = false
  }
}

async function quitarParticipante(p: { uid: string; nombre?: string | null }) {
  if (!cot.value || !user.canGestionarParticipantes || !p.uid) return
  participantesSaving.value = true
  try {
    const participantes = participantesActuales.value.filter(x => x.uid !== p.uid)
    const participanteUids = buildParticipanteUids(cot.value.vendedor?.uid, participantes)
    const participanteEmails = buildParticipanteEmails(participantes)
    await updateDoc(doc($db, 'cotizaciones', id.value), {
      participantes,
      participanteUids,
      participanteEmails,
      updatedAt: serverTimestamp(),
    })
    await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
      texto: `➖ ${user.nombre} quitó a ${p.nombre || 'un participante'} de la cotización.`,
      tipo: 'actividad',
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol },
    })
    await loadComerciales()
  } catch (e) {
    console.error('[PARTICIPANTES] quitar', e)
  } finally {
    participantesSaving.value = false
  }
}

async function abrirReasignar() {
  if (!comerciales.value.length) await loadComerciales()
  seleccionado.value = null
  esTemporal.value = false
  fechaDesde.value = new Date().toISOString().slice(0,10)
  fechaHasta.value = ''
  showReassign.value = true
}
async function confirmarReasignacion() {
  if (!seleccionado.value) return
  const nuevo = seleccionado.value
  const participantes = participantesOf(cot.value).filter(p => p.uid !== nuevo.uid)
  const update: any = {
    vendedorAnterior: cot.value?.vendedor || null,
    vendedor: {
      uid: nuevo.uid,
      nombre: nuevo.nombre || nuevo.displayName || 'Comercial',
      email: nuevo.email || null,
      rol: nuevo.rol || 'comercial',
    },
    participantes,
    participanteUids: buildParticipanteUids(nuevo.uid, participantes),
    participanteEmails: buildParticipanteEmails(participantes),
    updatedAt: serverTimestamp(),
    reasignacion: {
      temporal: esTemporal.value,
      desde: new Date(fechaDesde.value),
      hasta: esTemporal.value && fechaHasta.value ? new Date(fechaHasta.value) : null,
    }
  }
  await updateDoc(doc($db, 'cotizaciones', id.value), update)

  const texto = `Reasignada a ${update.vendedor.nombre}${esTemporal.value && fechaHasta.value ? ` (temporal hasta ${fechaHasta.value})` : ''}.`
  await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
    texto,
    tipo: 'actividad',
    fecha: serverTimestamp(),
    author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
  })

  await notifySlack(`🔁 Cotización “${cot.value?.nombre || cot.value?.cliente || id.value}” reasignada a ${update.vendedor.nombre}`, 'reasignacion')
  showReassign.value = false
}

function onPickChatFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  if (f.size > MAX_CHAT_FILE) {
    chatUploadError.value = `"${f.name}" supera 10 MB (${(f.size / 1024 / 1024).toFixed(1)} MB).`
    input.value = ''
    return
  }
  chatUploadError.value = ''
  fileToUpload.value = f
  input.value = ''
}

function clearPendingChatFile() {
  fileToUpload.value = null
  chatUploadError.value = ''
  if (chatFileInput.value) chatFileInput.value.value = ''
}

// --- dialogs resultado ---
const dlgWin = ref(false)
const dlgLose = ref(false)
const gifGanada = ref('')
const gifPerdida = ref('')

async function marcarGanada() {
  if (!cot.value) return;
  dlgConfirmacionCompra.value = true;
}

async function marcarAplazada() {
  if (!cot.value) return;

  // Actualizamos el estado de la cotización a 'aplazada'
  await updateDoc(doc($db, 'cotizaciones', id.value), {
    estado: 'aplazada',
    updatedAt: serverTimestamp(),
  });

  // Añadimos el comentario correspondiente
  await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
    fecha: serverTimestamp(),
    author: { uid: user.uid, nombre: user.nombre, rol: user.rol },
    texto: '🕒 Cotización marcada como APLAZADA.',
    tipo: 'actividad',
  });

  // Enviamos la notificación de Slack
  await notifySlack(`🕒 ${user.nombre} marcó la cotización “${cot.value?.cliente || id.value}” como *APLAZADA*`, 'aplazada');
}

async function marcarPerdida() {
  if (!cot.value) return;

  // Actualizamos el estado de la cotización a 'perdida'
  await updateDoc(doc($db, 'cotizaciones', id.value), {
    estado: 'perdida',
    updatedAt: serverTimestamp(),
  });

  // Añadimos el comentario correspondiente
  await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
    fecha: serverTimestamp(),
    author: { uid: user.uid, nombre: user.nombre, rol: user.rol },
    texto: '😔 Cotización marcada como PERDIDA.',
    tipo: 'actividad',
  });

  // Enviamos la notificación de Slack
  await notifySlack(`🙁 ${user.nombre} marcó la cotización “${cot.value?.cliente || id.value}” como *PERDIDA*`, 'perdida');

  // Enviamos el correo con los detalles de la cotización perdida
  await $fetch('/api/notify', {
    method: 'POST',
    body: {
      action: 'perdida',
      cotizacionId: cot.value.id,
      numero: cot.value.numero,
      cliente: cot.value.cliente,
      totalCotizado: totalCotizado.value,
      articulos: cot.value.articulos,
      destinatarios: {
        supervisor: supervisorEmail.value,
        comercial: destinatariosComercial(), 
      },
    },
  });

  gifPerdida.value = pickRandomGif('perdida')
  dlgLose.value = true;
}

async function confirmarCompra() {
  // Agregar un debug para verificar el estado de cot y cot.articulos
  console.log('Debug - cot.value:', cot.value);  // Ver el objeto completo de cot
  console.log('Debug - cot.value.articulos:', cot.value?.articulos);  // Ver los artículos de la cotización
  
  if (!cot.value || !cot.value.articulos) {
    console.error('Error - cot.value o cot.value.articulos no está definido');
    return; // Verificamos que cot.articulos existe antes de continuar
  }

  // Marcamos los artículos como comprados
  const nuevosArticulos = cot.value.articulos.map((articulo: any) => ({
    ...articulo,
    comprado: articulo.comprado || false,  // Marcamos los artículos comprados
  }));

  // Debug para ver cómo quedarán los artículos marcados
  console.log('Debug - nuevosArticulos:', nuevosArticulos);

  // Actualizamos los artículos en la base de datos
  await updateDoc(doc($db, 'cotizaciones', cot.value.id), {
    articulos: nuevosArticulos,
    estado: 'ganada',
    updatedAt: serverTimestamp(),
  });

  // Enviar notificación de correo y Slack después de confirmar la compra
  await $fetch('/api/notify', {
    method: 'POST',
    body: {
      action: 'ganada',
      cotizacionId: cot.value.id,
      numero: cot.value.numero,
      cliente: cot.value.cliente,
      articulos: nuevosArticulos.filter((articulo: any) => articulo.comprado),
      totalCotizado: totalCotizado.value,
      observaciones: cot.value.cotizadoObs,
      destinatarios: {
        supervisor: supervisorEmail.value,
        comercial: destinatariosComercial(),
      },
    },
  });

  // Enviar notificación de Slack
  await notifySlack(
    `🏆 La cotización #${cot.value.numero} para ${cot.value.cliente} ha sido ganada. Artículos confirmados: ${nuevosArticulos.filter((articulo: any) => articulo.comprado).map((articulo: any) => articulo.articulo).join(', ')}`,
    'ganada',
    [supervisorEmail.value, ...destinatariosComercial()].filter(Boolean) as string[],
  );

  // Cerrar diálogo de confirmación de compra
  dlgConfirmacionCompra.value = false;

  // Mostrar el diálogo de "Enhorabuena" para que el comercial vea que la cotización fue ganada
  gifGanada.value = pickRandomGif('ganada')
  dlgWin.value = true;
}




async function sendEmailNotification(status: string, cotizacion: any, toEmail: string) {
  try {
    await $fetch('/api/sendEmail', {
      method: 'POST',
      body: {
        subject: `La cotización ${status}`,
        message: `La cotización con cliente ${cotizacion.cliente} ha sido marcada como ${status}. Los artículos comprados son: ${cotizacion.articulos.filter((a: any) => a.comprado).map((a: any) => a.articulo).join(', ')}.`,
        to: toEmail,
      },
    });
  } catch (error) {
    console.error("Error enviando email:", error);
  }
}

// --- estado del editor inline de "precioCotizado" ---
const editIdx = ref<number|null>(null)
const editValor = ref<number|null>(null)
const editCoste = ref<number|null>(null)
const editProveedorIdx = ref<number|null>(null)
const editProveedor = ref('')

function abrirEditorPrecio(i: number) {
  const linea = cot.value?.articulos?.[i]
  editIdx.value = i
  // si no hay precio definido, parte de 0
  editValor.value = linea && typeof linea.precioCotizado === 'number'
    ? Number(linea.precioCotizado)
    : 0
}

function cancelarEditorPrecio() {
  editIdx.value = null
  editValor.value = null
}

async function guardarEditorPrecio() {
  if (editIdx.value === null || !cot.value || !user.canCotizar) return
  const i = editIdx.value
  const valor = Number(editValor.value ?? 0)
  if (isNaN(valor) || valor < 0) {
    // podrías usar un snackbar si prefieres
    console.warn('Precio cotizado inválido')
    return
  }

  // clonar líneas y aplicar cambio
  const nuevas = [...(cot.value.articulos || [])]
  nuevas[i] = { ...nuevas[i], precioCotizado: valor }

  try {
    await updateDoc(doc($db, 'cotizaciones', id.value), {
      articulos: nuevas,
      updatedAt: serverTimestamp()
    })

    // comentario y slack
    const linea = nuevas[i]
    const msg = `✏️ Precio cotizado actualizado por ${user.nombre || 'Vanessa'}: ` +
                `“${linea.articulo}” → ${valor.toFixed(2)} €`
    await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
      texto: msg,
      tipo: 'actividad',
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
    })
    if (isCotizada.value) {
      await notifySlack(`${msg} en la cotización “${cot.value?.cliente || id.value}”.`, 'precio_cotizado', destinatariosComercial())
    }

  } catch (e) {
    console.error('Error actualizando precioCotizado:', e)
  } finally {
    cancelarEditorPrecio()
  }
}

// Estado para el índice de la fila en edición y el valor que se está editando
const editCosteIdx = ref<number | null>(null)
const editCosteValor = ref<number | null>(null)
const canEditarCoste = computed(() => user.canEditarCoste)       // supervisor o compras
const canAñadirArticulo = computed(() => user.canAñadirArticulo) // supervisor o compras
const canBorrarCotizacion = computed(() => user.canBorrarCotizacion)

const showDelete = ref(false)
const deleting = ref(false)
const deleteError = ref('')

async function confirmarEliminar() {
  deleteError.value = ''
  deleting.value = true
  try {
    const { authFetch } = useAuthFetch()
    await authFetch(`/api/cotizaciones/${id.value}`, { method: 'DELETE' })
    showDelete.value = false
    await navigateTo('/cotizaciones')
  } catch (e: any) {
    deleteError.value = e?.data?.statusMessage || e?.message || 'No se pudo borrar la cotización'
  } finally {
    deleting.value = false
  }
}

function abrirEditorCoste(i: number) {
  const linea = cot.value?.articulos?.[i]
  editCosteIdx.value = i
  editCoste.value = linea && typeof linea.precioCoste === 'number'
    ? Number(linea.precioCoste)
    : 0
}
function cancelarEditorCoste() {
  editCosteIdx.value = null
  editCoste.value = null
}
async function guardarEditorPrecioCoste() {
  if (editCosteIdx.value === null || !cot.value) return
  const i = editCosteIdx.value
  const coste = Number(editCoste.value ?? 0)
  if (isNaN(coste) || coste < 0) { console.warn('Precio de coste inválido'); return }

  const nuevas = [...(cot.value.articulos || [])]
  nuevas[i] = { ...nuevas[i], precioCoste: coste }

  try {
    await updateDoc(doc($db, 'cotizaciones', id.value), {
      articulos: nuevas,
      updatedAt: serverTimestamp()
    })

    const linea = nuevas[i]
    const msg = `✏️ Precio de coste actualizado por ${user.nombre || 'Compras'}: ` +
                `“${linea.articulo}” → ${coste.toFixed(2)} €`
    await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
      texto: msg,
      tipo: 'actividad',
      visibilidad: 'privado',
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
    })
  } catch (e) {
    console.error('Error actualizando precio de coste:', e)
  } finally {
    cancelarEditorCoste()
  }
}

function abrirEditorProveedor(i: number) {
  editProveedorIdx.value = i
  editProveedor.value = String(cot.value?.articulos?.[i]?.proveedor || '')
}
function cancelarEditorProveedor() {
  editProveedorIdx.value = null
  editProveedor.value = ''
}
async function guardarEditorProveedor() {
  if (editProveedorIdx.value === null || !cot.value) return
  const i = editProveedorIdx.value
  const proveedor = editProveedor.value.trim()

  const nuevas = [...(cot.value.articulos || [])]
  nuevas[i] = { ...nuevas[i], proveedor: proveedor || null }

  try {
    await updateDoc(doc($db, 'cotizaciones', id.value), {
      articulos: nuevas,
      updatedAt: serverTimestamp(),
    })

    const linea = nuevas[i]
    const msg = `✏️ Proveedor actualizado por ${user.nombre || 'Usuario'}: ` +
                `"${linea.articulo}" → ${proveedor || '—'}`
    await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
      texto: msg,
      tipo: 'actividad',
      visibilidad: 'privado',
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol },
    })
  } catch (e) {
    console.error('Error actualizando proveedor:', e)
  } finally {
    cancelarEditorProveedor()
  }
}


// --- popup cotizar ---
const showCotizar = ref(false)
const modoRecotizar = ref(false)
type LineaCotizar = {
  codigoProducto: string
  descripcionProducto: string
  articulo: string
  unidades: number
  precioCoste: number | null
  precioCliente: number
  precioCotizado: number | null
}
const cotizarLineas = ref<LineaCotizar[]>([])
const cotizarObs = ref<string>('')

// --- popup solicitar recotización (comercial) ---
const showRecotizar = ref(false)
const recotizarMotivo = ref('')

function abrirCotizar(recotizar = false) {
  if (!cot.value || !user.canCotizar) return
  const yaCotizada = (cot.value.articulos || []).some((a: any) => a.precioCotizado != null)
  modoRecotizar.value = recotizar || yaCotizada
  cotizarLineas.value = (cot.value.articulos || []).map((a:any) => {
    const identidad = hydrateArticuloIdentidad(a)
    return {
      codigoProducto: identidad.codigoProducto,
      descripcionProducto: identidad.descripcionProducto,
      articulo: identidad.articulo,
      unidades: Number(a.unidades || 0),
      precioCoste: a.precioCoste != null ? Number(a.precioCoste) : null,
      precioCliente: Number(a.precioCliente || 0),
      precioCotizado: (a.precioCotizado != null ? Number(a.precioCotizado) : null),
    }
  })
  cotizarObs.value = modoRecotizar.value ? (cot.value.cotizadoObs || '') : ''
  showCotizar.value = true
}

function abrirRecotizar() {
  recotizarMotivo.value = ''
  showRecotizar.value = true
}

async function solicitarRecotizacion() {
  if (!cot.value) return
  const motivo = recotizarMotivo.value.trim()
  try {
    await updateDoc(doc($db, 'cotizaciones', id.value), {
      workflow: 'en_revision',
      estado: 'reabierta',
      recotizarSolicitadoAt: serverTimestamp(),
      recotizarSolicitadoPor: { uid: user.uid, nombre: user.nombre, rol: user.rol },
      recotizarMotivo: motivo || null,
      updatedAt: serverTimestamp(),
    })

    const msg = `🔄 ${user.nombre}${isSoloParticipante.value ? ' (participante)' : ''} solicita recotización de “${cot.value?.cliente || id.value}”${motivo ? `: ${motivo}` : ''}.`
    await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
      texto: msg,
      tipo: 'actividad',
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol },
    })

    if (!supervisorEmail.value) await loadSupervisor()
    await notifySlack(msg, 'recotizacion', supervisorEmail.value)
    await $fetch('/api/notify', {
      method: 'POST',
      body: {
        action: 'recotizacion',
        numero: cot.value?.numero || '',
        cliente: cot.value?.cliente || '',
        cotizacionId: id.value,
        motivo: motivo || 'Sin motivo indicado',
        comercial: user.nombre,
        totalCotizado: Number(cot.value?.totalCotizado || 0),
        articulos: cot.value?.articulos || [],
        destinatarios: {
          supervisor: supervisorEmail.value,
        },
      },
    })
    showRecotizar.value = false
  } catch (e) {
    console.error('Error solicitando recotización:', e)
  }
}

// helpers
const cotizarFaltan = computed(() =>
  cotizarLineas.value.some(l => l.precioCotizado == null || isNaN(Number(l.precioCotizado)) || Number(l.precioCotizado) < 0)
)

const totalTarifaDlg = computed(() =>
  cotizarLineas.value.reduce((a,l)=> a + (Number(l.unidades)||0)*(Number(l.precioCliente)||0), 0)
)
const totalCotizadoDlg = computed(() =>
  cotizarLineas.value.reduce((a,l)=> a + (Number(l.unidades)||0)*(Number(l.precioCotizado)||0), 0)
)
const descuentoCotizarDlg = computed(() =>
  descuentoPct(totalTarifaDlg.value, totalCotizadoDlg.value)
)

async function confirmarCotizacion() {
  if (!cot.value || !user.canCotizar) return
  // validación: todas las líneas con precioCotizado válido
  if (cotizarFaltan.value) {
    // puedes mostrar un snackbar si quieres
    console.warn('Faltan precios cotizados válidos en alguna línea')
    return
  }

  // construir nuevas líneas fusionando cambios
  const nuevas = (cot.value.articulos || []).map((a:any, idx:number) => ({
    ...a,
    precioCotizado: Number(cotizarLineas.value[idx].precioCotizado || 0),
  }))

  try {
    // 1) actualizar doc principal
    await updateDoc(doc($db, 'cotizaciones', id.value), {
      articulos: nuevas,
      estado: 'cotizada',              
      workflow: 'cotizado',             
      cotizadoAt: serverTimestamp(),
      cotizadoPor: { uid: user.uid, nombre: user.nombre, rol: user.rol },
      cotizadoObs: cotizarObs.value || null,
      recotizarSolicitadoAt: null,
      recotizarSolicitadoPor: null,
      recotizarMotivo: null,
      updatedAt: serverTimestamp(),
    })

    // 2) registrar comentario
    const msg = modoRecotizar.value
      ? `🔄 Recotización confirmada: total tarifa € ${totalTarifaDlg.value.toFixed(2)} · total cotizado € ${totalCotizadoDlg.value.toFixed(2)}`
      : `🧾 Cotización cerrada: total tarifa € ${totalTarifaDlg.value.toFixed(2)} · total cotizado € ${totalCotizadoDlg.value.toFixed(2)}`
    await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
      texto: `${msg}${cotizarObs.value ? `\nObservaciones: ${cotizarObs.value}` : ''}`,
      tipo: 'actividad',
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
    })

    // 3) avisar por Slack
    const slackMsg = modoRecotizar.value
      ? `🔄 Se **recotizó** la cotización “${cot.value?.cliente || id.value}” el ${new Date().toLocaleString('es-ES')}. Total cotizado: € ${totalCotizadoDlg.value.toFixed(2)}.`
      : `✅ Se **cotizó** la cotización “${cot.value?.cliente || id.value}” el ${new Date().toLocaleString('es-ES')}. Total cotizado: € ${totalCotizadoDlg.value.toFixed(2)}.`
    await notifySlack(slackMsg, 'cotizada', destinatariosComercial())

    showCotizar.value = false
    modoRecotizar.value = false

    // 4) emails (comercial + supervisor)
    // adapta la ruta a tu endpoint; reusa el que ya tengas para notificaciones
    try {
  const vendedor = {
    uid: cot.value?.vendedor?.uid || cot.value?.vendedorUid || null,
    nombre: cot.value?.vendedor?.nombre || null,
    email: cot.value?.vendedor?.email || null,
    rol:  cot.value?.vendedor?.rol || null,
  }

  // líneas con totales por línea
  const articulos = (cot.value?.articulos || []).map((a:any, i:number) => ({
    articulo: a.articulo || '',
    url: a.url || '',
    unidades: Number(a.unidades || 0),
    precioCliente: Number(a.precioCliente || 0),        // tarifa
    precioCoste: a.precioCoste != null ? Number(a.precioCoste) : null,
    precioSolicitado: a.precioSolicitado != null ? Number(a.precioSolicitado) : null,
    precioCompetencia: a.precioCompetencia != null ? Number(a.precioCompetencia) : null,
    precioCotizado: a.precioCotizado != null ? Number(a.precioCotizado) : null,
    compradoAntes: !!a.compradoAntes || (i === 0 && !!cot.value?.compradoAntes && a.compradoAntes == null),
    precioAnterior: a.precioAnterior != null
      ? Number(a.precioAnterior)
      : (i === 0 && cot.value?.precioAnterior != null ? Number(cot.value.precioAnterior) : null),
    totalTarifaLinea: Number(a.unidades || 0) * Number(a.precioCliente || 0),
    totalCotizadoLinea: Number(a.unidades || 0) * Number(a.precioCotizado || 0),
  }))

  await $fetch('/api/notify', {
    method: 'POST',
    body: {
      action: 'cotizada',
      cotizacionId: id.value,
      numero: cot.value?.numero || '',
      cliente: cot.value?.cliente || '',

      // cabecera / meta
      vendedor,
      tarifa: cot.value?.tarifa || '',
      licitacion: !!cot.value?.licitacion,
      stockEstado: cotStockEstado.value,
      stockDisponible: cot.value?.stockDisponible !== false,
      formaPagoSolicitada: cot.value?.formaPagoSolicitada || '',
      formaPagoActual: cot.value?.formaPagoActual || '',
      condicionesEspeciales: cot.value?.condicionesEspeciales || '',
      fechaDecision: cot.value?.fechaDecision || null,
      compradoAntes: cotizacionCompradoAntes(articulos),
      plazoEntrega: cot.value?.plazoEntrega || '',
      lugarEntrega: cot.value?.lugarEntrega || '',
      tipoEntrega: cot.value?.tipoEntrega || '',
      comentarioStock: cot.value?.comentarioStock || '',
      comentariosCliente: cot.value?.comentariosCliente || '',

      // detalle
      articulos,

      // totales del modal de cotizar
      totalTarifa: Number(totalTarifaDlg.value || 0),
      totalCotizado: Number(totalCotizadoDlg.value || 0),

      // observaciones del modal
      observaciones: cotizarObs.value || '',

      // por si quieres incluir adjuntos en el mail (opcional)
      adjuntos: (attachments.value || []).map((a:any)=>({
        id: a.id, nombre: a.nombre, url: a.url, tipo: a.tipo || null,
        createdAt: a.createdAt?.seconds ? new Date(a.createdAt.seconds*1000).toISOString() : null
      })),

      destinatarios: {
        comercial: destinatariosComercial(),
        supervisor: supervisorEmail.value || null,
      }
    }
  })
} catch (e) {
  console.warn('[COTIZAR] notify warning:', e)
}

  } catch (e) {
    console.error('Error al cotizar:', e)
  }
}
const showAdd = ref(false)
const nuevaLinea = reactive({
  codigoProducto: '', descripcionProducto: '', url: '', unidades: 1,
  precioCliente: 0, precioSolicitado: null as number|null,
  precioCompetencia: null as number|null, precioCoste: null as number|null,
  proveedor: '' as string,
})

async function agregarLinea() {
  if (!cot.value) return
  const identidad = buildArticuloIdentidad({
    codigoProducto: nuevaLinea.codigoProducto,
    descripcionProducto: nuevaLinea.descripcionProducto,
  })
  if (!identidad.codigoProducto || !identidad.descripcionProducto) return
  const linea = {
    codigoProducto: identidad.codigoProducto,
    descripcionProducto: identidad.descripcionProducto,
    articulo: identidad.articulo,
    url: (nuevaLinea.url||'').trim(),
    unidades: Number(nuevaLinea.unidades||1),
    precioCliente: Number(nuevaLinea.precioCliente||0),
    precioSolicitado: nuevaLinea.precioSolicitado!=null ? Number(nuevaLinea.precioSolicitado) : null,
    precioCompetencia: nuevaLinea.precioCompetencia!=null ? Number(nuevaLinea.precioCompetencia) : null,
    precioCoste: nuevaLinea.precioCoste!=null ? Number(nuevaLinea.precioCoste) : null,
    proveedor: canEditarCoste.value && nuevaLinea.proveedor.trim()
      ? nuevaLinea.proveedor.trim()
      : null,
  }
  const nuevas = [...(cot.value.articulos || []), linea]
  try {
    const patch: Record<string, unknown> = {
      articulos: nuevas,
      updatedAt: serverTimestamp(),
    }
    if (actorEsCompras() && !comprasHaRespondido(cot.value)) {
      patch.comprasAtendidoAt = serverTimestamp()
      patch.comprasRespondio = true
      patch.comprasAtendidoPor = {
        uid: user.uid,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol || 'compras',
      }
    }
    await updateDoc(doc($db, 'cotizaciones', id.value), patch)
    await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
      texto: `➕ ${user.nombre} añadió “${linea.articulo}” (${linea.unidades} uds).`,
      tipo: 'actividad',
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
    })

    if (actorEsCompras()) {
      if (!supervisorEmail.value) await loadSupervisor()
      await notifySlack(
        `➕ Compras añadió “${linea.articulo}” (${linea.unidades} uds) en la cotización #${cot.value?.numero} – ${cot.value?.cliente}.`,
        'linea_compras',
        supervisorEmail.value || null
      )
    }

    showAdd.value = false
    Object.assign(nuevaLinea, { codigoProducto:'', descripcionProducto:'', url:'', unidades:1, precioCliente:0, precioSolicitado:null, precioCompetencia:null, precioCoste:null, proveedor:'' })
  } catch(e){
    console.error('Error añadiendo artículo:', e)
  }
}

</script>


<template>
  <v-container class="py-6">
    <v-skeleton-loader
      v-if="loading"
      :type="['article', 'card', 'table', 'actions']"
    />

    <template v-else>
      <div v-if="!cot" class="my-10">
        <v-alert type="error" variant="tonal">
          No se encontró la cotización solicitada.
        </v-alert>
      </div>

      <template v-else>
        <!-- CABECERA -->
        <v-card class="pa-4 mb-6">
          <div class="d-flex justify-space-between align-center">
            <div class="d-flex align-center ga-3">
              <h2 class="text-h5 font-weight-bold">Cotización – {{ cot.cliente || '—' }}</h2>
              <template v-if="!isCotizada && !isGanada && !isPerdida && !isAplazada">
                <v-chip :color="estadoChip(cot.estado).color" size="small" label>
                  {{ estadoChip(cot.estado).text }}
                </v-chip>
                <v-chip v-if="cot.workflow" :color="workflowBadgeColor(cot.workflow)" size="small" label>
                  {{ workflowLabel(cot.workflow) }}
                </v-chip>
              </template>
              <v-chip v-if="isGanada || isPerdida || isAplazada" :color="isGanada ? 'success' : isPerdida ? 'error' : 'grey'" size="small" label>
                {{ isGanada ? 'Ganada' : isPerdida ? 'Perdida' : 'Aplazada' }}
              </v-chip>
              <v-chip v-if="isCotizada" color="blue-darken-2" size="small" label>
                  Cotizada
              </v-chip>
            </div>

            <div class="d-flex ga-2">
              <v-chip>
                <template #prepend><Icon name="mdi:calendar" class="me-1" /></template>
                Creada: {{ fmt(cot.fechaCreacion || cot.fecha) }}
              </v-chip>
              <v-chip>
                <template #prepend><Icon name="mdi:update" class="me-1" /></template>
                Actualizada: {{ fmt(cot.updatedAt || cot.fechaCreacion) }}
              </v-chip>
              <v-chip color="success">
                <template #prepend><Icon name="mdi:cash-multiple" class="me-1" /></template>
                Tarifa: {{ fmtMoney(totalCotizado) }}
              </v-chip>
              <v-chip v-if="totalPrecioCotizado != null" color="blue-darken-2" variant="tonal">
                <template #prepend><Icon name="mdi:tag-check" class="me-1" /></template>
                Cotizado: {{ fmtMoney(totalPrecioCotizado) }}
              </v-chip>
            </div>
          </div>
        </v-card>

        <v-row class="detail-layout">
         <!-- IZQUIERDA: Chat de comentarios -->
          <v-col cols="12" md="4" class="comments-col">
            <v-card class="pa-4 d-flex flex-column comments-card">
              <div class="d-flex align-center justify-space-between mb-3">
                <h3 class="text-subtitle-1 font-weight-bold mb-0">Comentarios</h3>
                <v-chip size="x-small" variant="tonal" color="primary">{{ chatComments.length }}</v-chip>
              </div>

              <div class="comment-input-box">
                <v-select
                  v-model="selectedArticulo"
                  :items="cot.articulos"
                  item-title="articulo"
                  item-value="articulo"
                  label="Artículo (opcional)"
                  variant="outlined"
                  density="compact"
                  hide-details
                  clearable
                  class="mb-2"
                />
                <v-alert
                  v-if="(user.isCompras || actorEsCompras()) && puedeAdjuntarEnChat"
                  type="info"
                  variant="tonal"
                  density="compact"
                  class="mb-2"
                >
                  Puedes adjuntar archivos y elegir si son <strong>públicos</strong> o <strong>solo para la supervisora</strong>.
                </v-alert>
                <v-textarea
                  v-model="newComment"
                  label="Escribe un comentario..."
                  rows="2"
                  auto-grow
                  variant="outlined"
                  hide-details
                  class="mb-2"
                  @keydown.ctrl.enter="onAddCommentClick"
                />
                <v-alert
                  v-if="chatUploadError"
                  type="error"
                  variant="tonal"
                  density="compact"
                  class="mb-2"
                  closable
                  @click:close="chatUploadError = ''"
                >
                  {{ chatUploadError }}
                </v-alert>
                <div v-if="fileToUpload" class="d-flex align-center ga-2 mb-2">
                  <v-chip size="small" variant="tonal" color="primary" closable @click:close="clearPendingChatFile">
                    <Icon name="mdi:paperclip" class="me-1" />
                    {{ fileToUpload.name }} ({{ (fileToUpload.size / 1024 / 1024).toFixed(2) }} MB)
                  </v-chip>
                  <small class="text-medium-emphasis">Pulsa Enviar para subir el archivo</small>
                </div>
                <div class="d-flex align-center ga-2">
                  <v-btn
                    color="primary"
                    size="small"
                    :loading="commentUploading"
                    :disabled="commentUploading || (!newComment.trim() && !fileToUpload)"
                    @click="onAddCommentClick"
                  >
                    <template #prepend><Icon name="mdi:send" class="me-1" /></template>
                    Enviar
                  </v-btn>
                  <v-btn
                    variant="tonal"
                    size="small"
                    color="secondary"
                    :disabled="commentUploading || !puedeAdjuntarEnChat"
                    title="Adjuntar archivo"
                    @click="chatFileInput?.click()"
                  >
                    <template #prepend><Icon name="mdi:paperclip" /></template>
                    Adjuntar
                  </v-btn>
                  <input
                    ref="chatFileInput"
                    type="file"
                    class="d-none"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv"
                    @change="onPickChatFile"
                  />
                </div>
              </div>

              <v-dialog v-model="showVisibilityDialog" max-width="460px">
                <v-card>
                  <v-card-title class="text-h6">Visibilidad del mensaje</v-card-title>
                  <v-card-text>
                    <v-chip
                      v-if="fileToUpload"
                      size="small"
                      variant="tonal"
                      color="primary"
                      class="mb-3"
                    >
                      <Icon name="mdi:paperclip" class="me-1" />
                      {{ fileToUpload.name }}
                    </v-chip>
                    <p class="mb-0">{{ visibilityDialogText }}</p>
                  </v-card-text>
                  <v-card-actions>
                    <v-spacer />
                    <v-btn variant="tonal" @click="setCommentVisibility('publico')">{{ visibilityPublicoLabel }}</v-btn>
                    <v-btn color="primary" @click="setCommentVisibility('privado')">{{ visibilityPrivadoLabel }}</v-btn>
                  </v-card-actions>
                </v-card>
              </v-dialog>

              <v-divider class="my-3" />

              <div class="comments-scroll chat-thread">
                <div v-if="!chatComments.length" class="chat-empty">
                  <Icon name="mdi:forum-outline" class="chat-empty-icon" />
                  <p class="mb-1">Sin comentarios todavía</p>
                  <small class="text-medium-emphasis">Usa el cuadro de arriba para iniciar la conversación</small>
                </div>

                <div
                  v-for="c in chatComments"
                  :key="c.id"
                  class="chat-message"
                  :class="{ 'chat-message--mine': c.author?.uid === user.uid }"
                >
                  <v-avatar
                    :color="colorByRol(c.author?.rol, c.author?.nombre || c.user)"
                    size="32"
                    class="chat-avatar"
                  >
                    {{ initials(c.author?.nombre || c.user || '—') }}
                  </v-avatar>
                  <div class="chat-bubble" :class="{ 'chat-bubble--private': c.visibilidad === 'privado' }">
                    <div class="chat-bubble-header">
                      <strong>{{ c.author?.nombre || c.user || '—' }}</strong>
                      <span class="chat-time">{{ fmt(c.fecha) }}</span>
                      <v-chip
                        v-if="c.visibilidad === 'privado'"
                        size="x-small"
                        color="deep-orange"
                        variant="tonal"
                        class="ms-1"
                      >
                        {{ (c.author?.rol || '').toLowerCase() === 'compras' ? 'Solo supervisora' : 'Privado' }}
                      </v-chip>
                    </div>
                    <div v-if="c.articuloId" class="chat-articulo-tag">
                      <Icon name="mdi:package-variant" />
                      {{ c.articuloId }}
                    </div>
                    <div v-if="c.texto" class="chat-text">{{ c.texto }}</div>
                    <a
                      v-if="c.attachment"
                      :href="c.attachment.url"
                      target="_blank"
                      rel="noopener"
                      class="chat-attachment"
                    >
                      <Icon name="mdi:paperclip" />
                      {{ c.attachment.nombre }}
                    </a>
                  </div>
                </div>
              </div>
            </v-card>
          </v-col>




          <!-- DERECHA: Detalles -->
          <v-col cols="12" md="8" class="detail-col">
            <v-card class="detail-card">
              <div v-if="isGanada" class="stamp stamp-won">GANADA</div>
              <div v-else-if="isPerdida" class="stamp stamp-lost">PERDIDA</div>
              <div v-else-if="isAplazada" class="stamp stamp-lost" style="color: grey; border-color: grey;">APLAZADA</div>

              <div class="detail-card__header">
                <div>
                  <p class="detail-eyebrow">Cotización #{{ cot.numero || '—' }}</p>
                  <div class="detail-title-row">
                    <h3 class="detail-title">Ficha</h3>
                    <v-chip
                      v-if="cotPendienteStrip"
                      size="small"
                      label
                      :color="cotPendienteStrip.kind === 'supervisor' ? 'primary' : 'warning'"
                      variant="tonal"
                      class="detail-status-chip"
                    >
                      {{ cotPendienteStrip.meta.title }}
                    </v-chip>
                  </div>
                </div>
                <div class="detail-card__actions">
                  <v-btn
                    v-if="user.canGestionarParticipantes"
                    variant="tonal"
                    color="indigo"
                    size="small"
                    @click="abrirParticipantes"
                  >
                    <template #prepend><Icon name="mdi:account-multiple-plus" /></template>
                    Participantes
                    <v-chip
                      v-if="participantesActuales.length"
                      size="x-small"
                      color="indigo"
                      class="ms-1"
                    >
                      {{ participantesActuales.length }}
                    </v-chip>
                  </v-btn>
                  <v-btn
                    v-if="canEditFull"
                    variant="tonal"
                    color="primary"
                    size="small"
                    @click="navigateTo(`/cotizaciones/${id}/editar`)"
                  >
                    <template #prepend><Icon name="mdi:pencil" /></template>
                    Editar
                  </v-btn>
                  <v-btn
                    v-if="canEditArticulos"
                    variant="tonal"
                    color="primary"
                    size="small"
                    @click="navigateTo(`/cotizaciones/${id}/editar`)"
                  >
                    <template #prepend><Icon name="mdi:cube-outline" /></template>
                    Editar artículos
                  </v-btn>
                  <v-btn
                    v-if="canAñadirArticulo && !isCotizada && !isGanada && !isPerdida && !isAplazada"
                    variant="tonal"
                    color="primary"
                    size="small"
                    @click="detailTab = 'articulos'; showAdd = true"
                  >
                    <template #prepend><Icon name="mdi:plus" /></template>
                    Artículo
                  </v-btn>
                  <v-btn
                    v-if="canBorrarCotizacion"
                    variant="tonal"
                    color="error"
                    size="small"
                    @click="showDelete = true"
                  >
                    <template #prepend><Icon name="mdi:delete-outline" /></template>
                    Eliminar
                  </v-btn>
                </div>
              </div>

              <nav class="detail-switcher" aria-label="Secciones de la cotización">
                <div class="detail-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    class="detail-tab"
                    :class="{ 'detail-tab--active': detailTab === 'detalles' }"
                    :aria-selected="detailTab === 'detalles'"
                    @click="detailTab = 'detalles'"
                  >
                    <Icon name="mdi:clipboard-text-outline" class="detail-tab__icon" />
                    <span class="detail-tab__label">Detalles</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    class="detail-tab"
                    :class="{ 'detail-tab--active': detailTab === 'articulos' }"
                    :aria-selected="detailTab === 'articulos'"
                    @click="detailTab = 'articulos'"
                  >
                    <Icon name="mdi:package-variant-closed" class="detail-tab__icon" />
                    <span class="detail-tab__label">Artículos</span>
                    <span class="detail-tab__count">{{ (cot.articulos || []).length }}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    class="detail-tab"
                    :class="{ 'detail-tab--active': detailTab === 'notas' }"
                    :aria-selected="detailTab === 'notas'"
                    @click="detailTab = 'notas'"
                  >
                    <Icon name="mdi:text-box-outline" class="detail-tab__icon" />
                    <span class="detail-tab__label">Notas</span>
                    <span v-if="tieneNotas" class="detail-tab__dot" aria-hidden="true"></span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    class="detail-tab"
                    :class="{ 'detail-tab--active': detailTab === 'actividad' }"
                    :aria-selected="detailTab === 'actividad'"
                    @click="detailTab = 'actividad'"
                  >
                    <Icon name="mdi:history" class="detail-tab__icon" />
                    <span class="detail-tab__label">Actividad</span>
                    <span class="detail-tab__count">{{ activityTimeline.length }}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    class="detail-tab"
                    :class="{ 'detail-tab--active': detailTab === 'adjuntos' }"
                    :aria-selected="detailTab === 'adjuntos'"
                    @click="detailTab = 'adjuntos'"
                  >
                    <Icon name="mdi:paperclip" class="detail-tab__icon" />
                    <span class="detail-tab__label">Adjuntos</span>
                    <span class="detail-tab__count">{{ attachments.length }}</span>
                  </button>
                </div>
              </nav>

              <div class="detail-tab-panels">
                <div v-show="detailTab === 'detalles'" class="detail-tab-panel" role="tabpanel">
                  <div
                    v-if="cotPendienteStrip"
                    class="pendiente-compras pendiente-compras--detail"
                    :class="cotPendienteStrip.kind === 'supervisor' ? 'pendiente-compras--supervisor' : 'pendiente-compras--compras'"
                  >
                    <span class="pendiente-compras__icon-wrap">
                      <Icon :name="cotPendienteStrip.kind === 'supervisor' ? 'mdi:account-supervisor-outline' : 'mdi:clipboard-text-clock-outline'" />
                    </span>
                    <div class="pendiente-compras__copy">
                      <div class="pendiente-compras__row">
                        <strong>{{ cotPendienteStrip.meta.title }}</strong>
                        <span class="pendiente-compras__tag">{{ cotPendienteStrip.meta.stockTag }}</span>
                      </div>
                      <span class="pendiente-compras__hint">{{ cotPendienteStrip.meta.hint }}</span>
                    </div>
                  </div>

                  <div
                    v-if="user.canGestionarParticipantes || participantesActuales.length || (isParticipant && !isOwner)"
                    class="participantes-strip"
                    :class="{ 'participantes-strip--guest': isParticipant && !isOwner && !user.canGestionarParticipantes }"
                  >
                    <div class="participantes-strip__head">
                      <span class="participantes-strip__icon-wrap">
                        <Icon name="mdi:account-multiple-outline" />
                      </span>
                      <div class="participantes-strip__copy">
                        <div class="participantes-strip__row">
                          <strong>Participantes</strong>
                          <span v-if="participantesActuales.length" class="participantes-strip__tag">
                            {{ participantesActuales.length }} comercial{{ participantesActuales.length === 1 ? '' : 'es' }}
                          </span>
                        </div>
                        <span class="participantes-strip__hint">
                          <template v-if="isSoloParticipante">
                            Estás siguiendo esta cotización como participante. Puedes comentar, editar y solicitar recotización.
                          </template>
                          <template v-else-if="user.canGestionarParticipantes">
                            Añade comerciales de otras marcas o áreas para que vean la cotización y reciban email y Slack.
                          </template>
                          <template v-else>
                            Comerciales adicionales que siguen esta cotización.
                          </template>
                        </span>
                      </div>
                      <v-btn
                        v-if="user.canGestionarParticipantes"
                        color="indigo"
                        variant="flat"
                        size="small"
                        @click="abrirParticipantes"
                      >
                        <template #prepend><Icon name="mdi:account-plus" /></template>
                        Añadir participante
                      </v-btn>
                    </div>

                    <div class="participantes-strip__people">
                      <div class="participantes-strip__person participantes-strip__person--owner">
                        <v-avatar size="28" color="primary" variant="tonal">
                          {{ initials(cot.vendedor?.nombre || 'V') }}
                        </v-avatar>
                        <div class="participantes-strip__person-meta">
                          <span class="participantes-strip__person-name">{{ cot.vendedor?.nombre || '—' }}</span>
                          <span class="participantes-strip__person-role">Vendedor asignado</span>
                        </div>
                      </div>

                      <div
                        v-for="p in participantesActuales"
                        :key="p.uid"
                        class="participantes-strip__person"
                      >
                        <v-avatar size="28" color="indigo" variant="tonal">
                          {{ initials(p.nombre || p.email || 'P') }}
                        </v-avatar>
                        <div class="participantes-strip__person-meta">
                          <span class="participantes-strip__person-name">{{ p.nombre || p.email || 'Comercial' }}</span>
                          <span class="participantes-strip__person-role">Participante</span>
                        </div>
                        <v-btn
                          v-if="user.canGestionarParticipantes"
                          icon
                          variant="text"
                          size="x-small"
                          color="error"
                          title="Quitar participante"
                          @click="quitarParticipante(p)"
                        >
                          <Icon name="mdi:close" />
                        </v-btn>
                      </div>

                      <div v-if="user.canGestionarParticipantes && !participantesActuales.length" class="participantes-strip__empty">
                        <Icon name="mdi:account-plus-outline" />
                        Sin participantes extra todavía
                      </div>
                    </div>
                  </div>

                  <div class="detail-kpi-strip">
                    <div class="detail-kpi">
                      <span class="detail-kpi__label">Total tarifa</span>
                      <span class="detail-kpi__value">{{ fmtMoney(totalCotizado) }}</span>
                    </div>
                    <div v-if="totalPrecioCotizado != null" class="detail-kpi detail-kpi--accent">
                      <span class="detail-kpi__label">Total cotizado</span>
                      <span class="detail-kpi__value precio-cotizado">
                        {{ fmtMoney(totalPrecioCotizado) }}
                        <span v-if="descuentoGlobal != null" class="detail-kpi__pct">
                          ({{ descuentoGlobal.toFixed(1) }}%)
                        </span>
                      </span>
                    </div>
                    <div class="detail-kpi">
                      <span class="detail-kpi__label">Artículos</span>
                      <span class="detail-kpi__value">{{ (cot.articulos || []).length }}</span>
                    </div>
                    <div class="detail-kpi">
                      <span class="detail-kpi__label">Decisión</span>
                      <span class="detail-kpi__value detail-kpi__value--sm">{{ fmtDateStr(cot.fechaDecision) }}</span>
                    </div>
                  </div>

                  <div class="detail-sections">
                    <section class="detail-section">
                      <h4 class="detail-section__title">
                        <Icon name="mdi:account-group-outline" />
                        Información general
                      </h4>
                      <dl class="detail-grid">
                        <div class="detail-field">
                          <dt>Cliente</dt>
                          <dd>{{ cot.cliente || '—' }}</dd>
                        </div>
                        <div class="detail-field">
                          <dt>Vendedor</dt>
                          <dd>{{ cot.vendedor?.nombre || '—' }}</dd>
                        </div>
                        <div class="detail-field">
                          <dt>Tarifa</dt>
                          <dd>{{ tarifaLabel(cot.tarifa) }}</dd>
                        </div>
                        <div class="detail-field">
                          <dt>Licitación</dt>
                          <dd>
                            <v-chip size="x-small" :color="cot.licitacion ? 'primary' : 'grey'" label>
                              {{ cot.licitacion ? 'Sí' : 'No' }}
                            </v-chip>
                          </dd>
                        </div>
                      </dl>
                    </section>

                    <section class="detail-section">
                      <h4 class="detail-section__title">
                        <Icon name="mdi:cash-multiple" />
                        Condiciones comerciales
                      </h4>
                      <dl class="detail-grid">
                        <div class="detail-field">
                          <dt>Pago solicitado</dt>
                          <dd>{{ cot.formaPagoSolicitada || '—' }}</dd>
                        </div>
                        <div class="detail-field">
                          <dt>Pago actual</dt>
                          <dd>{{ cot.formaPagoActual || '—' }}</dd>
                        </div>
                        <div class="detail-field detail-field--wide">
                          <dt>Condiciones especiales</dt>
                          <dd>{{ cot.condicionesEspeciales || '—' }}</dd>
                        </div>
                      </dl>
                    </section>

                    <section class="detail-section">
                      <h4 class="detail-section__title">
                        <Icon name="mdi:truck-delivery-outline" />
                        Logística
                      </h4>
                      <dl class="detail-grid">
                        <div class="detail-field">
                          <dt>Stock</dt>
                          <dd>
                            <v-chip size="x-small" :color="cotStockColor" label>
                              {{ cotStockLabel }}
                            </v-chip>
                          </dd>
                        </div>
                        <div class="detail-field">
                          <dt>Tipo entrega</dt>
                          <dd>
                            <v-chip
                              v-if="cot.tipoEntrega"
                              size="x-small"
                              :color="cot.tipoEntrega === 'envio' ? 'primary' : 'teal'"
                              label
                            >
                              {{ tipoEntregaLabel(cot.tipoEntrega) }}
                            </v-chip>
                            <span v-else>—</span>
                          </dd>
                        </div>
                        <div class="detail-field">
                          <dt>Plazo entrega</dt>
                          <dd>{{ cot.plazoEntrega || '—' }}</dd>
                        </div>
                        <div class="detail-field detail-field--wide">
                          <dt>{{ cot.tipoEntrega === 'envio' ? 'Dirección de envío' : cot.tipoEntrega === 'recogida' ? 'Lugar de recogida' : 'Lugar entrega' }}</dt>
                          <dd>{{ cot.lugarEntrega || '—' }}</dd>
                        </div>
                      </dl>
                    </section>
                  </div>
                </div>

                <div v-show="detailTab === 'articulos'" class="detail-tab-panel" role="tabpanel">
                  <div class="detail-table-section">
                    <div class="articulos-header">
                      <h4 class="detail-section__title mb-0">
                        <Icon name="mdi:package-variant-closed" />
                        Artículos
                      </h4>
                      <v-chip size="small" variant="tonal" color="primary">
                        {{ (cot.articulos || []).length }} líneas
                      </v-chip>
                    </div>

                <div class="articulos-list">
                  <article
                    v-for="(a, i) in cot.articulos || []"
                    :key="i"
                    class="articulo-card"
                    :class="{
                      'articulo-card--no-comprado': !a.comprado && isGanada,
                      'articulo-card--editing': editIdx === i || editCosteIdx === i || editProveedorIdx === i,
                    }"
                  >
                    <div class="articulo-card__head">
                      <span class="articulo-card__index">{{ String(Number(i) + 1).padStart(2, '0') }}</span>
                      <div class="articulo-card__title-wrap">
                        <v-tooltip :text="articuloLabel(a)" location="top" max-width="420">
                          <template #activator="{ props }">
                            <div v-bind="props">
                              <span v-if="a.codigoProducto || !a.descripcionProducto" class="articulo-card__code">
                                {{ a.codigoProducto || articuloLabel(a) }}
                              </span>
                              <h5 v-if="a.descripcionProducto" class="articulo-card__title">{{ a.descripcionProducto }}</h5>
                              <h5 v-else-if="!a.codigoProducto" class="articulo-card__title">{{ a.articulo }}</h5>
                            </div>
                          </template>
                        </v-tooltip>
                      </div>
                      <v-btn
                        :href="a.url || undefined"
                        :disabled="!a.url"
                        target="_blank"
                        rel="noopener"
                        variant="text"
                        color="primary"
                        size="small"
                        icon
                        class="articulo-card__link"
                        title="Ver artículo en web"
                      >
                        <Icon name="mdi:open-in-new" />
                      </v-btn>
                    </div>

                    <div class="articulo-card__grid">
                      <div class="articulo-metric">
                        <span class="articulo-metric__label">Unidades</span>
                        <span class="articulo-metric__value">{{ a.unidades || 0 }}</span>
                      </div>
                      <div class="articulo-metric">
                        <span class="articulo-metric__label">Tarifa / ud.</span>
                        <span class="articulo-metric__value">{{ fmtMoney(Number(a.precioCliente || 0)) }}</span>
                      </div>
                      <div class="articulo-metric articulo-metric--highlight">
                        <span class="articulo-metric__label">Total cliente</span>
                        <span class="articulo-metric__value">{{ fmtMoney((Number(a.unidades || 0) * Number(a.precioCliente || 0))) }}</span>
                      </div>
                      <div class="articulo-metric articulo-metric--highlight">
                        <span class="articulo-metric__label">Total cotizado</span>
                        <span class="articulo-metric__value">
                          <template v-if="a.precioCotizado != null">
                            {{ fmtMoney((Number(a.unidades || 0) * Number(a.precioCotizado || 0))) }}
                            <span v-if="descuentoLinea(a) != null" class="articulo-metric__discount">
                              −{{ descuentoLinea(a)!.toFixed(1) }}%
                            </span>
                          </template>
                          <span v-else class="text-medium-emphasis">—</span>
                        </span>
                      </div>
                    </div>

                    <div class="articulo-card__quote-row">
                      <div class="articulo-quote editable-celda">
                        <span class="articulo-quote__label">Precio cotizado / ud.</span>
                        <div class="articulo-quote__value">
                          <template v-if="editIdx !== i">
                            <span v-if="a.precioCotizado != null" class="precio-cotizado">
                              {{ fmtMoney(Number(a.precioCotizado || 0)) }}
                            </span>
                            <span v-else class="text-medium-emphasis">Sin cotizar</span>
                            <v-icon-btn
                              v-if="canEditarPrecioCotizado"
                              class="edit-icon"
                              size="small"
                              @click="abrirEditorPrecio(i)"
                              :title="`Editar precio cotizado de ${a.articulo}`"
                            >
                              <Icon name="mdi:pencil" />
                            </v-icon-btn>
                          </template>
                          <v-slide-x-transition>
                            <div v-if="editIdx === i && canEditarPrecioCotizado" class="articulo-quote__editor">
                              <v-text-field
                                v-model.number="editValor"
                                type="number"
                                min="0"
                                density="compact"
                                variant="outlined"
                                hide-details
                                placeholder="0.00"
                                autofocus
                              >
                                <template #append-inner><Icon name="mdi:currency-eur" /></template>
                              </v-text-field>
                              <v-icon-btn color="primary" size="small" @click="guardarEditorPrecio">
                                <Icon name="mdi:content-save" />
                              </v-icon-btn>
                              <v-icon-btn color="error" size="small" @click="cancelarEditorPrecio">
                                <Icon name="mdi:close" />
                              </v-icon-btn>
                            </div>
                          </v-slide-x-transition>
                        </div>
                      </div>

                      <div v-if="canEditarCoste" class="articulo-quote editable-celda">
                        <span class="articulo-quote__label">Coste / ud.</span>
                        <div class="articulo-quote__value">
                          <template v-if="editCosteIdx !== i">
                            <span v-if="a.precioCoste != null">{{ fmtMoney(Number(a.precioCoste || 0)) }}</span>
                            <span v-else class="text-medium-emphasis">—</span>
                            <v-icon-btn
                              class="edit-icon"
                              size="small"
                              @click="abrirEditorCoste(i)"
                              :title="`Editar precio coste de ${a.articulo}`"
                            >
                              <Icon name="mdi:pencil" />
                            </v-icon-btn>
                          </template>
                          <v-slide-x-transition>
                            <div v-if="editCosteIdx === i" class="articulo-quote__editor">
                              <v-text-field
                                v-model.number="editCoste"
                                type="number"
                                min="0"
                                density="compact"
                                variant="outlined"
                                hide-details
                                placeholder="0.00"
                                autofocus
                              >
                                <template #append-inner><Icon name="mdi:currency-eur" /></template>
                              </v-text-field>
                              <v-icon-btn color="primary" size="small" @click="guardarEditorPrecioCoste">
                                <Icon name="mdi:content-save" />
                              </v-icon-btn>
                              <v-icon-btn color="error" size="small" @click="cancelarEditorCoste">
                                <Icon name="mdi:close" />
                              </v-icon-btn>
                            </div>
                          </v-slide-x-transition>
                        </div>
                      </div>

                      <div v-if="canEditarCoste" class="articulo-quote editable-celda">
                        <span class="articulo-quote__label">Proveedor</span>
                        <div class="articulo-quote__value">
                          <template v-if="editProveedorIdx !== i">
                            <span v-if="a.proveedor" class="articulo-quote__proveedor">{{ a.proveedor }}</span>
                            <span v-else class="text-medium-emphasis">Sin proveedor</span>
                            <v-icon-btn
                              class="edit-icon"
                              size="small"
                              @click="abrirEditorProveedor(i)"
                              :title="`Editar proveedor de ${a.articulo}`"
                            >
                              <Icon name="mdi:pencil" />
                            </v-icon-btn>
                          </template>
                          <v-slide-x-transition>
                            <div v-if="editProveedorIdx === i" class="articulo-quote__editor">
                              <v-text-field
                                v-model="editProveedor"
                                density="compact"
                                variant="outlined"
                                hide-details
                                placeholder="Nombre del proveedor"
                                autofocus
                              >
                                <template #prepend-inner><Icon name="mdi:truck-delivery-outline" /></template>
                              </v-text-field>
                              <v-icon-btn color="primary" size="small" @click="guardarEditorProveedor">
                                <Icon name="mdi:content-save" />
                              </v-icon-btn>
                              <v-icon-btn color="error" size="small" @click="cancelarEditorProveedor">
                                <Icon name="mdi:close" />
                              </v-icon-btn>
                            </div>
                          </v-slide-x-transition>
                        </div>
                      </div>
                    </div>

                    <div v-if="lineaTieneExtras(a, i)" class="articulo-card__extras">
                      <span v-if="a.precioSolicitado != null" class="articulo-tag">
                        Solicitado {{ fmtMoney(Number(a.precioSolicitado || 0)) }}
                      </span>
                      <span v-if="a.precioCompetencia != null" class="articulo-tag">
                        Competencia {{ fmtMoney(Number(a.precioCompetencia || 0)) }}
                      </span>
                      <span v-if="lineaCompradoAntes(a, i)" class="articulo-tag articulo-tag--info">
                        Compra anterior
                        <template v-if="lineaPrecioAnterior(a, i) != null">
                          · {{ fmtMoney(lineaPrecioAnterior(a, i)) }}
                        </template>
                      </span>
                    </div>
                  </article>
                </div>

                <div class="articulos-totals">
                  <div class="articulos-totals__label">Totales cotización</div>
                  <div class="articulos-totals__metrics">
                    <div class="articulos-totals__metric">
                      <span class="articulos-totals__caption">Total cliente</span>
                      <span class="articulos-totals__amount">{{ fmtMoney(totalCotizado) }}</span>
                    </div>
                    <div class="articulos-totals__metric">
                      <span class="articulos-totals__caption">Total cotizado</span>
                      <span v-if="totalPrecioCotizado != null" class="articulos-totals__amount precio-cotizado">
                        {{ fmtMoney(totalPrecioCotizado) }}
                        <span v-if="descuentoGlobal != null" class="articulos-totals__discount">
                          −{{ descuentoGlobal.toFixed(1) }}%
                        </span>
                      </span>
                      <span v-else class="articulos-totals__amount text-medium-emphasis">—</span>
                    </div>
                  </div>
                </div>
                  </div>
                </div>

                <div v-show="detailTab === 'notas'" class="detail-tab-panel" role="tabpanel">
                  <section class="detail-notes detail-notes--tab">
                    <template v-if="tieneNotas">
                      <article v-if="cot.comentarioStock" class="note-block">
                        <h5 class="note-block__title">Comentario de stock</h5>
                        <div class="note-block__body">
                          <FormattedText :text="cot.comentarioStock" />
                        </div>
                      </article>
                      <article v-if="cot.comentariosCliente" class="note-block">
                        <h5 class="note-block__title">Comentarios del cliente</h5>
                        <div class="note-block__body">
                          <FormattedText :text="cot.comentariosCliente" />
                        </div>
                      </article>
                    </template>
                    <div v-else class="detail-empty">
                      <Icon name="mdi:text-box-remove-outline" />
                      <p>No hay notas en esta cotización.</p>
                    </div>
                  </section>
                </div>

                <div v-show="detailTab === 'actividad'" class="detail-tab-panel" role="tabpanel">
                  <div class="activity-tab">
                    <div class="d-flex align-center justify-space-between mb-3">
                      <h4 class="detail-section__title mb-0">
                        <Icon name="mdi:history" />
                        Historial de actividad
                      </h4>
                      <v-chip size="x-small" variant="tonal">{{ activityTimeline.length }}</v-chip>
                    </div>
                    <div v-if="activityTimeline.length" class="activity-scroll activity-scroll--tab">
                      <div
                        v-for="(item, idx) in activityTimeline"
                        :key="item.id"
                        class="activity-item"
                        :class="{ 'activity-item--last': idx === activityTimeline.length - 1 }"
                      >
                        <div class="activity-icon" :class="`activity-icon--${item.tone}`">
                          <Icon :name="item.icon" />
                        </div>
                        <div class="activity-body">
                          <div class="activity-title">{{ item.title }}</div>
                          <div v-if="item.subtitle" class="activity-subtitle">{{ item.subtitle }}</div>
                          <div class="activity-time">{{ fmt(item.fecha) }}</div>
                        </div>
                      </div>
                    </div>
                    <div v-else class="detail-empty">
                      <Icon name="mdi:timeline-clock-outline" />
                      <p>Aún no hay actividad registrada.</p>
                    </div>
                  </div>
                </div>

                <div v-show="detailTab === 'adjuntos'" class="detail-tab-panel" role="tabpanel">
                  <div class="adjuntos-tab">
                    <div class="d-flex align-center justify-space-between mb-3">
                      <h4 class="detail-section__title mb-0">
                        <Icon name="mdi:paperclip" />
                        Adjuntos
                      </h4>
                      <v-chip size="small" variant="tonal">{{ attachments.length }}</v-chip>
                    </div>

                    <div v-if="!attachments.length" class="detail-empty">
                      <Icon name="mdi:file-outline" />
                      <p>Sin adjuntos todavía.</p>
                    </div>

                    <v-list v-else density="comfortable" class="adjuntos-list">
                      <v-list-item
                        v-for="a in attachments"
                        :key="a.id"
                        :title="a.nombre || 'Archivo'"
                        :subtitle="fmt(a.createdAt)"
                      >
                        <template #prepend>
                          <v-avatar size="28" class="bg-blue-lighten-5">
                            <Icon :name="(a.tipo||'').startsWith('image/') ? 'mdi:image' : 'mdi:paperclip'" />
                          </v-avatar>
                        </template>
                        <template #append>
                          <v-btn :href="a.url" target="_blank" rel="noopener" variant="tonal" size="small">
                            <template #prepend><Icon name="mdi:open-in-new" /></template>
                            Abrir
                          </v-btn>
                        </template>
                      </v-list-item>
                    </v-list>
                  </div>
                </div>
              </div>
            </v-card>

            <v-card
              v-if="cot.recotizarMotivo && !isCotizada && !isGanada && !isPerdida && !isAplazada"
              class="detail-notice detail-notice--warning mt-4 pa-4"
            >
              <span class="detail-notice__icon"><Icon name="mdi:refresh" /></span>
              <div>
                <strong>Recotización solicitada</strong>
                <p class="mb-0">{{ cot.recotizarMotivo }}</p>
              </div>
            </v-card>
            <v-card v-if="cot.cotizadoObs" class="detail-notice detail-notice--info mt-4 pa-4">
              <span class="detail-notice__icon"><Icon name="mdi:alert-circle-outline" /></span>
              <div>
                <strong>Observaciones de cotización</strong>
                <p class="mb-0">{{ cot.cotizadoObs }}</p>
              </div>
            </v-card>

            <!-- Acciones: estados y botones al final -->
            <v-card class="acciones-card mt-4" variant="flat" rounded="lg">

            <!-- Antes de cotizar: solo Supervisor puede mover workflow / cotizar -->
            <template v-if="!isCotizada && !isGanada && !isPerdida && !isAplazada">
              <div class="acciones-row">
                <span class="acciones-label">Cambiar estado</span>
                <div class="acciones-buttons">
                  <v-btn
                    v-if="isSupervisor"
                    size="small"
                    :variant="cot.workflow === 'en_revision' ? 'flat' : 'tonal'"
                    :disabled="cot.workflow === 'en_revision'"
                    color="warning"
                    @click="setWorkflow('en_revision')"
                  >
                    <template #prepend><Icon name="mdi:eye" /></template>En revisión
                  </v-btn>

                  <v-btn
                    v-if="isSupervisor"
                    size="small"
                    :variant="cot.workflow === 'consultando' ? 'flat' : 'tonal'"
                    :disabled="cot.workflow === 'consultando'"
                    color="info"
                    @click="setWorkflow('consultando')"
                  >
                    <template #prepend><Icon name="mdi:truck" /></template>Consultando proveedor
                  </v-btn>

                  <v-btn
                    v-if="isSupervisor"
                    size="small"
                    :variant="cot.workflow === 'consultando_compras' ? 'flat' : 'tonal'"
                    :disabled="cot.workflow === 'consultando_compras'"
                    color="teal"
                    @click="setWorkflow('consultando_compras')"
                  >
                    <template #prepend><Icon name="mdi:cart" /></template>Consultando a compras
                  </v-btn>

                  <v-btn
                    v-if="isSupervisor"
                    size="small"
                    :variant="cot.workflow === 'espera_comercial' ? 'flat' : 'tonal'"
                    :disabled="cot.workflow === 'espera_comercial'"
                    color="secondary"
                    @click="setWorkflow('espera_comercial')"
                  >
                    <template #prepend><Icon name="mdi:account-clock" /></template>En espera comercial
                  </v-btn>

                  <v-btn
                    v-if="isParticipant && !isCotizada"
                    size="small"
                    :variant="cot.workflow === 'espera_cliente' ? 'flat' : 'tonal'"
                    :disabled="cot.workflow === 'espera_cliente'"
                    color="secondary"
                    @click="setWorkflow('espera_cliente')"
                  >
                    <template #prepend><Icon name="mdi:account-clock" /></template>A la espera del cliente
                  </v-btn>
                </div>
              </div>

              <v-divider v-if="user.canCotizar" class="my-3" />

              <div v-if="user.canCotizar || isOwner" class="acciones-row acciones-row--primary">
                <div class="acciones-buttons">
                  <v-btn v-if="user.canCotizar" color="success" @click="abrirCotizar">
                    <template #prepend><Icon name="mdi:cash-check" class="me-2" /></template>Cotizar
                  </v-btn>

                  <v-btn v-if="isSupervisor" color="secondary" variant="tonal" @click="abrirReasignar">
                    <template #prepend><Icon name="mdi:account-switch" class="me-2" /></template>Reasignar
                  </v-btn>

                  <v-btn v-if="isOwner || isSupervisor" color="grey" @click="marcarAplazada">
                    <template #prepend><Icon name="mdi:clock-outline" class="me-2" /></template>APLAZADA
                  </v-btn>
                </div>
              </div>
            </template>

            <!-- Tras cotizar: comercial marca Ganada/Perdida o solicita recotización -->
            <template v-else-if="isCotizada && !isGanada && !isPerdida && !isAplazada">
              <div class="acciones-row acciones-row--primary">
                <v-alert type="info" variant="tonal" class="mr-auto">
                  Cotización cerrada. Pendiente de resultado.
                </v-alert>
                <div class="acciones-buttons">
                  <v-btn v-if="isParticipant" color="warning" variant="tonal" @click="abrirRecotizar">
                    <template #prepend><Icon name="mdi:refresh" class="me-2" /></template>Solicitar recotización
                  </v-btn>
                  <v-btn v-if="user.canCotizar" color="warning" @click="abrirCotizar(true)">
                    <template #prepend><Icon name="mdi:cash-check" class="me-2" /></template>Recotizar
                  </v-btn>
                  <v-btn v-if="isOwner" color="success" @click="marcarGanada">
                    <template #prepend><Icon name="mdi:trophy" class="me-2" /></template>GANADA
                  </v-btn>
                  <v-btn v-if="isOwner" color="error" @click="marcarPerdida">
                    <template #prepend><Icon name="mdi:emoticon-sad-outline" class="me-2" /></template>PERDIDA
                  </v-btn>
                  <v-btn v-if="isOwner || isSupervisor" color="grey" @click="marcarAplazada">
                    <template #prepend><Icon name="mdi:clock-outline" class="me-2" /></template>APLAZADA
                  </v-btn>
                </div>
              </div>
            </template>

            <!-- Estado final -->
            <template v-else>
              <v-alert :type="isGanada ? 'success' : isPerdida ? 'error' : 'info'" variant="tonal" class="mb-0">
                {{ isGanada ? 'Esta cotización fue GANADA.' : isPerdida ? 'Esta cotización fue PERDIDA.' : 'Esta cotización fue APLAZADA.' }}
              </v-alert>
            </template>
            </v-card>

          </v-col>
        </v-row>

        <!-- Diálogo Reasignar -->
        <v-dialog v-model="showReassign" width="540">
          <v-card>
            <v-card-title class="text-h6">Reasignar cotización</v-card-title>
            <v-card-text>
              <v-autocomplete
                v-model="seleccionado"
                :items="comerciales"
                item-title="nombre"
                item-value="uid"
                return-object
                label="Selecciona comercial"
                variant="outlined"
                :loading="!comerciales.length"
                hide-details
              >
                <template #item="{ props, item }">
                  <v-list-item v-bind="props" :title="item?.raw?.nombre" :subtitle="item?.raw?.email" />
                </template>
              </v-autocomplete>
              <v-divider class="my-4" />

              <v-switch v-model="esTemporal" color="primary" inset label="¿Es temporal?" hide-details />

              <v-row v-if="esTemporal" class="mt-1">
                <v-col cols="12" sm="6">
                  <v-text-field v-model="fechaDesde" type="date" label="Desde" variant="outlined" hide-details />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field v-model="fechaHasta" type="date" :min="fechaDesde" label="Hasta" variant="outlined" hide-details />
                </v-col>
              </v-row>

              <v-alert v-if="esTemporal && (!fechaHasta || fechaHasta < fechaDesde)" type="warning" variant="tonal" class="mt-3">
                Selecciona una fecha "Hasta" igual o posterior a "Desde".
              </v-alert>
            </v-card-text>

            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="showReassign=false">Cancelar</v-btn>
              <v-btn color="primary" :disabled="!canConfirmReassign" @click="confirmarReasignacion">Confirmar</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- Diálogo Participantes -->
        <v-dialog v-model="showParticipantes" width="540">
          <v-card>
            <v-card-title class="text-h6">Añadir participante</v-card-title>
            <v-card-text>
              <p class="text-medium-emphasis mb-4">
                El comercial podrá ver esta cotización, comentar en el chat y recibir avisos por email y Slack.
              </p>
              <v-autocomplete
                v-model="participanteSeleccionado"
                :items="comercialesParaParticipante"
                item-title="nombre"
                item-value="uid"
                return-object
                label="Selecciona comercial"
                variant="outlined"
                :loading="!comerciales.length"
                hide-details
              >
                <template #item="{ props, item }">
                  <v-list-item v-bind="props" :title="item?.raw?.nombre" :subtitle="item?.raw?.email" />
                </template>
              </v-autocomplete>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="showParticipantes=false">Cancelar</v-btn>
              <v-btn
                color="primary"
                :loading="participantesSaving"
                :disabled="!participanteSeleccionado"
                @click="confirmarParticipante"
              >
                Añadir
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- DIALOGO SOLICITAR RECOTIZACIÓN -->
        <v-dialog v-model="showRecotizar" max-width="520">
          <v-card>
            <v-card-title class="text-h6">Solicitar recotización</v-card-title>
            <v-card-text>
              <p class="mb-4">
                Indica el motivo si el cliente pide otro precio. El supervisor recibirá la solicitud y podrá ajustar la cotización.
              </p>
              <v-textarea
                v-model="recotizarMotivo"
                label="Motivo (opcional)"
                variant="outlined"
                rows="3"
                auto-grow
                placeholder="Ej.: El cliente acepta si bajamos el precio del artículo X..."
              >
                <template #prepend-inner><Icon name="mdi:comment-text-outline" /></template>
              </v-textarea>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="showRecotizar=false">Cancelar</v-btn>
              <v-btn color="warning" @click="solicitarRecotizacion">
                <template #prepend><Icon name="mdi:send" class="me-1" /></template>
                Enviar solicitud
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- DIALOGO COTIZAR -->
        <v-dialog v-model="showCotizar" max-width="960">
          <v-card>
            <v-card-title class="text-h6">
              {{ modoRecotizar ? 'Recotizar' : 'Cotizar' }} – {{ cot?.cliente || '—' }}
            </v-card-title>

            <v-card-text>
              <v-table density="comfortable">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Descripción</th>
                    <th class="text-right">Unid.</th>
                    <th class="text-right">Precio coste</th>
                    <th class="text-right">Precio tarifa</th>
                    <th class="text-right">Precio cotizado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(l, i) in cotizarLineas" :key="i">
                    <td class="cotizar-codigo">{{ l.codigoProducto || '—' }}</td>
                    <td style="max-width:280px">{{ l.descripcionProducto || l.articulo }}</td>
                    <td class="text-right">{{ l.unidades }}</td>
                    <td class="text-right">
                      <span v-if="l.precioCoste != null">{{ fmtMoney(Number(l.precioCoste || 0)) }}</span>
                      <span v-else class="text-medium-emphasis">—</span>
                    </td>
                    <td class="text-right">{{ fmtMoney(Number(l.precioCliente || 0)) }}</td>
                    <td class="text-right" style="width:180px">
                      <v-text-field
                        v-model.number="l.precioCotizado"
                        type="number"
                        min="0"
                        step="0.01"
                        density="compact"
                        variant="outlined"
                        hide-details
                        :error="l.precioCotizado == null || Number(l.precioCotizado) < 0"
                        style="max-width:160px; margin-left:auto"
                      >
                        <template #append-inner><Icon name="mdi:currency-eur" /></template>
                      </v-text-field>
                    </td>
                  </tr>
                </tbody>
              </v-table>

              <v-divider class="my-4" />

              <v-textarea
                v-model="cotizarObs"
                label="Observaciones (opcional)"
                variant="outlined"
                rows="3"
                auto-grow
              >
                <template #prepend-inner><Icon name="mdi:note-text-outline" /></template>
              </v-textarea>

              <div class="d-flex justify-end ga-4 mt-2">
                <v-chip variant="tonal">Total tarifa: € {{ totalTarifaDlg.toFixed(2) }}</v-chip>
                <v-chip color="success" variant="tonal">
                  Total cotizado: € {{ totalCotizadoDlg.toFixed(2) }}
                  <span v-if="descuentoCotizarDlg != null" class="precio-cotizado ms-1">
                    ({{ descuentoCotizarDlg.toFixed(1) }}%)
                  </span>
                </v-chip>
              </div>

              <v-alert
                v-if="cotizarFaltan"
                type="warning"
                variant="tonal"
                class="mt-4"
              >
                Revisa: todas las líneas deben tener un <strong>precio cotizado</strong> ≥ 0.
              </v-alert>
            </v-card-text>

            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="showCotizar=false">Cancelar</v-btn>
              <v-btn color="primary" :disabled="cotizarFaltan" @click="confirmarCotizacion">
                <template #prepend><Icon name="mdi:check-decagram" class="me-2" /></template>
                {{ modoRecotizar ? 'Confirmar recotización' : 'Confirmar cotización' }}
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- Dialog GANADA -->
        <!-- Dialog Confirmación de Compra -->
        <v-dialog v-model="dlgConfirmacionCompra" max-width="800px">
          <v-card>
            <v-card-title>
              <span class="text-h6">Confirmar compra de artículos</span>
            </v-card-title>
            <v-card-text>
              <v-alert type="warning" color="yellow" class="mb-4">
                **Observaciones del Supervisor:** {{ cot.cotizadoObs || 'No hay observaciones' }}
              </v-alert>
              <v-table>
                <thead>
                  <tr>
                    <th>Artículo</th>
                    <th class="text-right">Unidades</th>
                    <th class="text-right">Seleccionado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(articulo, i) in cot.articulos" :key="i">
                    <td>{{ articulo.articulo }}</td>
                    <td class="text-right">{{ articulo.unidades }}</td>
                   <td class="text-center">
                      <div class="checkbox-container">
                        <input 
                          type="checkbox" 
                          v-model="articulo.comprado" 
                          :id="'checkbox-' + i" 
                          class="custom-checkbox" 
                        />
                        <label :for="'checkbox-' + i">{{ articulo.articulo }}</label>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn text @click="dlgConfirmacionCompra = false">Cancelar</v-btn>
              <v-btn color="success" @click="confirmarCompra">Confirmar Compra</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>


        <v-dialog v-model="dlgWin" max-width="420">
          <v-card class="pa-4" color="green-lighten-5">
            <div class="text-h6 mb-2">¡Enhorabuena! 🎉</div>
            <img v-if="gifGanada" :src="gifGanada" alt="Celebración" class="resultado-gif" />
            <div class="mt-3">La cotización se ha marcado como <strong>GANADA</strong>.</div>
            <v-card-actions class="mt-2">
              <v-spacer />
              <v-btn color="primary" @click="dlgWin = false">Cerrar</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- Dialog PERDIDA -->
        <v-dialog v-model="dlgLose" max-width="420">
          <v-card class="pa-4" color="red-lighten-5">
            <div class="text-h6 mb-2">Se perdió 😔</div>
            <img v-if="gifPerdida" :src="gifPerdida" alt="Cotización perdida" class="resultado-gif" />
            <div class="mt-3">La cotización se ha marcado como <strong>PERDIDA</strong>.</div>
            <v-card-actions class="mt-2"><v-spacer/><v-btn color="primary" @click="dlgLose=false">Cerrar</v-btn></v-card-actions>
          </v-card>
        </v-dialog>

        <!-- Dialog ELIMINAR -->
        <v-dialog v-model="showDelete" max-width="480" persistent>
          <v-card>
            <v-card-title class="text-h6">Eliminar cotización</v-card-title>
            <v-card-text>
              <p>
                ¿Deseas eliminar la cotización
                <strong>#{{ cot?.numero || '—' }}</strong>
                de <strong>{{ cot?.cliente || '—' }}</strong>?
              </p>
              <p class="text-medium-emphasis mt-2 mb-0">Esta acción no se puede deshacer.</p>
              <v-alert v-if="deleteError" type="error" variant="tonal" class="mt-4" density="compact">
                {{ deleteError }}
              </v-alert>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" :disabled="deleting" @click="showDelete = false">Cancelar</v-btn>
              <v-btn color="error" :loading="deleting" @click="confirmarEliminar">Eliminar</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <!-- DIALOGO AÑADIR ARTÍCULO -->
        <v-dialog v-model="showAdd" max-width="640">
          <v-card>
            <v-card-title class="text-h6">Añadir artículo</v-card-title>
            <v-card-text>
              <v-row dense>
                <v-col cols="12" md="4"><v-text-field v-model="nuevaLinea.codigoProducto" label="Código producto" variant="outlined" hide-details required /></v-col>
                <v-col cols="12" md="8"><v-text-field v-model="nuevaLinea.descripcionProducto" label="Descripción producto" variant="outlined" hide-details required /></v-col>
                <v-col cols="12"><v-text-field v-model="nuevaLinea.url" label="URL (opcional)" variant="outlined" hide-details /></v-col>
                <v-col cols="6"><v-text-field v-model.number="nuevaLinea.unidades" type="number" min="1" label="Unidades" variant="outlined" hide-details /></v-col>
                <v-col cols="6"><v-text-field v-model.number="nuevaLinea.precioCliente" type="number" min="0" step="0.01" label="Precio tarifa" variant="outlined" hide-details /></v-col>
                <v-col cols="6"><v-text-field v-model.number="nuevaLinea.precioSolicitado" type="number" min="0" step="0.01" label="Precio solicitado (opcional)" variant="outlined" hide-details /></v-col>
                <v-col cols="6"><v-text-field v-model.number="nuevaLinea.precioCompetencia" type="number" min="0" step="0.01" label="Precio competencia (opcional)" variant="outlined" hide-details /></v-col>
                <v-col v-if="canEditarCoste" cols="6"><v-text-field v-model.number="nuevaLinea.precioCoste" type="number" min="0" step="0.01" label="Precio coste (opcional)" variant="outlined" hide-details /></v-col>
                <v-col v-if="canEditarCoste" cols="6"><v-text-field v-model="nuevaLinea.proveedor" label="Proveedor (opcional)" variant="outlined" hide-details /></v-col>
              </v-row>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="showAdd=false">Cancelar</v-btn>
              <v-btn color="primary" :disabled="!nuevaLinea.codigoProducto.trim() || !nuevaLinea.descripcionProducto.trim()" @click="agregarLinea">Añadir</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>


      </template>
    </template>
  </v-container>
</template>
<style scoped>
.acciones-card {
  width: 100%;
  max-width: 100%;
  padding: 16px 20px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.detail-switcher {
  margin: 12px 16px 0;
  padding: 5px;
  border-radius: 16px;
  background: linear-gradient(180deg, #e8eef6 0%, #eef2f7 100%);
  border: 1px solid #d8e0ea;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}
.detail-tabs {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 5px;
  overflow: visible;
}
.detail-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
  min-height: 44px;
  border: 1px solid transparent;
  background: transparent;
  color: #64748b;
  font-size: 0.84rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1.1;
  padding: 10px 10px;
  cursor: pointer;
  border-radius: 12px;
  transition:
    color 160ms cubic-bezier(0.23, 1, 0.32, 1),
    background 160ms cubic-bezier(0.23, 1, 0.32, 1),
    border-color 160ms cubic-bezier(0.23, 1, 0.32, 1),
    box-shadow 160ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.detail-tab__icon {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  border-radius: 8px;
  font-size: 17px;
  color: #1e4b8c;
  background: #dbeafe;
  transition: background 160ms cubic-bezier(0.23, 1, 0.32, 1), color 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.detail-tab__icon :deep(svg) {
  color: inherit;
  opacity: 1;
}
.detail-tab__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-tab:hover {
  color: #1e293b;
  background: rgba(255, 255, 255, 0.62);
}
.detail-tab:hover .detail-tab__icon {
  background: #bfdbfe;
  color: #0d47a1;
}
.detail-tab:active {
  transform: scale(0.985);
}
.detail-tab:focus-visible {
  outline: 2px solid #1976d2;
  outline-offset: 2px;
}
.detail-tab--active {
  color: #0f172a;
  background: #fff;
  border-color: #cfdceb;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.05),
    0 6px 16px rgba(15, 23, 42, 0.08);
}
.detail-tab--active .detail-tab__icon {
  color: #fff;
  background: #1565c0;
}
.detail-tab--active .detail-tab__label {
  color: #0f172a;
}
.detail-tab__count {
  display: inline-grid;
  place-items: center;
  min-width: 1.3rem;
  height: 1.3rem;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  background: #d7dee8;
  color: #475569;
}
.detail-tab--active .detail-tab__count {
  background: #1565c0;
  color: #fff;
}
.detail-tab__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1976d2;
  box-shadow: 0 0 0 3px rgba(25, 118, 210, 0.16);
  flex-shrink: 0;
}
.detail-tab-panels {
  margin: 18px 16px 16px;
  padding: 12px 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #fafbfd;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.02);
}
.detail-tab-panel {
  animation: detail-tab-in 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes detail-tab-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .detail-tab,
  .detail-tab-panel {
    transition: none;
    animation: none;
  }
}
@media (max-width: 1100px) {
  .detail-tab__label {
    font-size: 0.75rem;
  }
  .detail-tab__icon {
    width: 26px;
    height: 26px;
  }
}
@media (max-width: 700px) {
  .detail-tabs {
    grid-template-columns: repeat(5, minmax(4.5rem, 1fr));
    overflow-x: auto;
    scrollbar-width: none;
  }
  .detail-tabs::-webkit-scrollbar {
    display: none;
  }
  .detail-tab {
    flex-direction: column;
    gap: 5px;
    padding: 8px 4px;
    min-height: 58px;
  }
  .detail-tab__label {
    font-size: 0.68rem;
  }
  .detail-tab-panels {
    margin-top: 14px;
  }
}
.detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  color: #94a3b8;
  text-align: center;
}
.detail-empty :deep(svg),
.detail-empty .iconify {
  font-size: 28px;
  opacity: 0.7;
}
.detail-empty p {
  margin: 0;
  font-size: 0.9rem;
  color: #64748b;
}
.detail-notes--tab,
.activity-tab,
.adjuntos-tab {
  padding: 8px 12px 12px;
}
.note-block + .note-block {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid #e2e8f0;
}
.note-block__title {
  margin: 0 0 8px;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #64748b;
}
.note-block__body {
  font-size: 0.92rem;
  line-height: 1.55;
  color: #0f172a;
  max-height: 420px;
  overflow-y: auto;
}
.activity-scroll--tab {
  max-height: min(55vh, 480px);
}
.adjuntos-list {
  background: transparent;
}
.resultado-gif {
  width: 100%;
  border-radius: 8px;
  display: block;
}
.acciones-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  width: 100%;
}
.acciones-row + .acciones-row {
  margin-top: 4px;
}
.acciones-row--primary {
  justify-content: flex-end;
}
.acciones-label {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.55);
  flex: 0 0 auto;
  margin-right: 4px;
}
.acciones-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1 1 0;
  min-width: 0;
  width: 100%;
}
.acciones-buttons .v-btn {
  flex: 1 1 auto;
}
@media (max-width: 700px) {
  .acciones-row--primary {
    justify-content: flex-start;
  }
  .acciones-buttons {
    width: 100%;
  }
  .acciones-buttons .v-btn {
    flex: 1 1 auto;
  }
}

.detail-layout {
  align-items: flex-start;
}
.detail-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  width: 100%;
}
.detail-col > .detail-card,
.detail-col > .acciones-card,
.detail-col > .detail-notice {
  width: 100%;
  max-width: 100%;
}
.comments-col {
  align-self: flex-start;
}
@media (min-width: 960px) {
  .comments-col {
    position: sticky;
    top: 16px;
    z-index: 3;
  }
  .comments-card {
    height: calc(100vh - 32px);
    max-height: calc(100vh - 32px);
  }
}
.comments-card {
  height: 66vh;
  max-height: 720px;
}

.comment-input-box {
  flex-shrink: 0; /* ocupa solo lo necesario */
}

.comments-scroll {
  flex: 1;             /* ocupa el resto del card */
  min-height: 0;       /* truco para que flexbox permita scroll */
  overflow-y: auto;
  padding-right: 8px;
}

.comments-scroll::-webkit-scrollbar {
  width: 6px;
}
.comments-scroll::-webkit-scrollbar-thumb {
  background-color: rgba(0,0,0,0.3);
  border-radius: 6px;
}

/* Chat */
.chat-thread {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: rgba(0,0,0,0.45);
  padding: 24px 12px;
}
.chat-empty-icon {
  font-size: 40px;
  margin-bottom: 8px;
  opacity: 0.5;
}
.chat-message {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.chat-message--mine {
  flex-direction: row-reverse;
}
.chat-message--mine .chat-bubble {
  background: #e3f2fd;
  border-color: #bbdefb;
}
.chat-message--mine .chat-bubble-header {
  flex-direction: row-reverse;
}
.chat-bubble {
  flex: 1;
  min-width: 0;
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  padding: 8px 12px;
  max-width: calc(100% - 40px);
}
.chat-bubble--private {
  background: #fff8f0;
  border-color: #ffcc80;
}
.chat-bubble-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  font-size: 0.8rem;
}
.chat-time {
  color: rgba(0,0,0,0.45);
  font-size: 0.75rem;
}
.chat-articulo-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  background: rgba(0,0,0,0.06);
  border-radius: 6px;
  padding: 2px 8px;
  margin-bottom: 4px;
  font-weight: 600;
}
.chat-text {
  font-size: 0.875rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.chat-attachment {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  font-size: 0.8rem;
  color: #1565c0;
  text-decoration: none;
}
.chat-attachment:hover {
  text-decoration: underline;
}

/* Activity timeline */
.activity-card {
  background: #fafafa;
}
.activity-scroll {
  max-height: 280px;
  overflow-y: auto;
  padding-right: 4px;
}
.activity-item {
  display: flex;
  gap: 12px;
  position: relative;
  padding-bottom: 16px;
}
.activity-item:not(.activity-item--last)::before {
  content: '';
  position: absolute;
  left: 15px;
  top: 32px;
  bottom: 0;
  width: 2px;
  background: #e0e0e0;
}
.activity-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  background: #eceff1;
  color: #546e7a;
  z-index: 1;
}
.activity-icon--primary { background: #e3f2fd; color: #1565c0; }
.activity-icon--blue { background: #e3f2fd; color: #1976d2; }
.activity-icon--green { background: #e8f5e9; color: #2e7d32; }
.activity-icon--amber { background: #fff8e1; color: #f57f17; }
.activity-icon--red { background: #ffebee; color: #c62828; }
.activity-icon--purple { background: #f3e5f5; color: #7b1fa2; }
.activity-icon--slate { background: #eceff1; color: #546e7a; }
.activity-body {
  flex: 1;
  min-width: 0;
  padding-top: 2px;
}
.activity-title {
  font-size: 0.8125rem;
  line-height: 1.4;
  word-break: break-word;
}
.activity-subtitle {
  font-size: 0.75rem;
  color: rgba(0,0,0,0.55);
  margin-top: 2px;
}
.activity-time {
  font-size: 0.7rem;
  color: rgba(0,0,0,0.4);
  margin-top: 4px;
}

/* Detail card */
.detail-card {
  position: relative;
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid rgba(25, 118, 210, 0.08);
  padding: 0;
}
.detail-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 0;
}
.detail-card__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.pendiente-compras{
  display:flex;
  align-items:flex-start;
  gap:12px;
  margin:16px 24px 0;
  padding:14px 16px;
  border-radius:14px;
}
.pendiente-compras--detail{
  margin-bottom:4px;
}
.pendiente-compras--compras{
  background: linear-gradient(135deg, #f5f3ff 0%, #eef2ff 100%);
  border: 1px solid rgba(99, 102, 241, 0.18);
}
.pendiente-compras--supervisor{
  background: linear-gradient(135deg, #f0f9ff 0%, #ecfeff 100%);
  border: 1px solid rgba(14, 165, 233, 0.18);
}
.pendiente-compras--compras .pendiente-compras__icon-wrap{ color:#6366f1; }
.pendiente-compras--supervisor .pendiente-compras__icon-wrap{ color:#0ea5e9; }
.pendiente-compras--compras strong{ color:#312e81; }
.pendiente-compras--compras .pendiente-compras__tag{
  color:#4338ca;
  border-color:rgba(99, 102, 241, 0.2);
}
.pendiente-compras--supervisor strong{ color:#0c4a6e; }
.pendiente-compras--supervisor .pendiente-compras__tag{
  color:#0369a1;
  border-color:rgba(14, 165, 233, 0.22);
}
.pendiente-compras__icon-wrap{
  width:40px;
  height:40px;
  border-radius:11px;
  display:grid;
  place-items:center;
  flex-shrink:0;
  background:rgba(255,255,255,0.85);
  color:#6366f1;
  font-size:1.25rem;
}
.pendiente-compras__copy{
  min-width:0;
  flex:1;
}
.pendiente-compras__row{
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:8px;
}
.pendiente-compras strong{
  font-size:.92rem;
  font-weight:700;
  letter-spacing:-0.01em;
}
.pendiente-compras__tag{
  display:inline-flex;
  align-items:center;
  padding:2px 10px;
  border-radius:999px;
  font-size:.74rem;
  font-weight:600;
  background:rgba(255,255,255,0.75);
  border:1px solid transparent;
}
.pendiente-compras__hint{
  display:block;
  margin-top:5px;
  font-size:.82rem;
  line-height:1.45;
  color:#64748b;
}
.participantes-strip{
  display:flex;
  flex-direction:column;
  gap:14px;
  margin:16px 24px 0;
  padding:16px 18px;
  border-radius:14px;
  background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%);
  border: 1px solid rgba(99, 102, 241, 0.22);
}
.participantes-strip--guest{
  background: linear-gradient(135deg, #faf5ff 0%, #eef2ff 100%);
  border-color: rgba(124, 58, 237, 0.2);
}
.participantes-strip__head{
  display:flex;
  align-items:flex-start;
  gap:12px;
}
.participantes-strip__icon-wrap{
  width:40px;
  height:40px;
  border-radius:11px;
  display:grid;
  place-items:center;
  flex-shrink:0;
  background:rgba(255,255,255,0.9);
  color:#6366f1;
  font-size:1.25rem;
}
.participantes-strip__copy{
  min-width:0;
  flex:1;
}
.participantes-strip__row{
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:8px;
}
.participantes-strip strong{
  font-size:.95rem;
  font-weight:700;
  color:#312e81;
  letter-spacing:-0.01em;
}
.participantes-strip__tag{
  display:inline-flex;
  align-items:center;
  padding:2px 10px;
  border-radius:999px;
  font-size:.74rem;
  font-weight:600;
  color:#4338ca;
  background:rgba(255,255,255,0.8);
  border:1px solid rgba(99, 102, 241, 0.18);
}
.participantes-strip__hint{
  display:block;
  margin-top:4px;
  font-size:.8rem;
  color:#475569;
  line-height:1.4;
}
.participantes-strip__people{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  padding-top:2px;
}
.participantes-strip__person{
  display:flex;
  align-items:center;
  gap:10px;
  padding:8px 12px 8px 8px;
  border-radius:12px;
  background:rgba(255,255,255,0.82);
  border:1px solid rgba(99, 102, 241, 0.12);
  min-width:180px;
}
.participantes-strip__person--owner{
  border-color:rgba(59, 130, 246, 0.2);
  background:rgba(255,255,255,0.95);
}
.participantes-strip__person-meta{
  display:flex;
  flex-direction:column;
  min-width:0;
  flex:1;
}
.participantes-strip__person-name{
  font-size:.84rem;
  font-weight:600;
  color:#1e293b;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.participantes-strip__person-role{
  font-size:.72rem;
  color:#64748b;
}
.participantes-strip__empty{
  display:flex;
  align-items:center;
  gap:8px;
  padding:10px 14px;
  border-radius:12px;
  border:1px dashed rgba(99, 102, 241, 0.28);
  color:#64748b;
  font-size:.82rem;
  background:rgba(255,255,255,0.55);
}
.detail-eyebrow {
  margin: 0 0 4px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #64748b;
}
.detail-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: #0f172a;
}
.detail-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.detail-status-chip {
  font-weight: 600;
}
.detail-tab-panel .pendiente-compras--detail,
.detail-tab-panel .participantes-strip {
  margin-left: 8px;
  margin-right: 8px;
}
.detail-tab-panel .detail-kpi-strip {
  padding: 12px 16px 8px;
}
.detail-kpi-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  padding: 16px 24px 20px;
  border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(180deg, #f8fafc 0%, #fff 100%);
}
.detail-kpi {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px 14px;
}
.detail-kpi--accent {
  border-color: #fecaca;
  background: #fffbfb;
}
.detail-kpi__label {
  display: block;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #64748b;
  margin-bottom: 4px;
}
.detail-kpi__value {
  font-size: 1.1rem;
  font-weight: 700;
  color: #0f172a;
}
.detail-kpi__value--sm {
  font-size: 0.95rem;
  font-weight: 600;
}
.detail-kpi__pct {
  font-size: 0.85rem;
  font-weight: 600;
}
.detail-sections {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 16px;
}
.detail-section {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
}
.detail-section--full {
  grid-column: 1 / -1;
}
.detail-section__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 0.82rem;
  font-weight: 700;
  color: #334155;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
  margin: 0;
}
.detail-grid--notes {
  grid-template-columns: 1fr;
}
.detail-field {
  min-width: 0;
}
.detail-field--wide {
  grid-column: 1 / -1;
}
.detail-field dt {
  margin: 0 0 2px;
  font-size: 0.72rem;
  font-weight: 600;
  color: #64748b;
}
.detail-field dd {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
  color: #0f172a;
  word-break: break-word;
}
.detail-field__rich {
  padding: 12px 14px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #e8edf4;
  max-height: 420px;
  overflow-y: auto;
}
.detail-table-section {
  padding: 16px 16px 24px;
}
.articulos-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.articulos-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: min(72vh, 920px);
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-gutter: stable;
}
.articulo-card {
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #fff;
  padding: 14px 16px;
  transition: border-color 160ms ease-out, box-shadow 160ms ease-out;
}
.articulo-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.05);
}
.articulo-card--editing {
  border-color: #93c5fd;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}
.articulo-card--no-comprado {
  background: #fff5f5;
  border-color: #fecaca;
}
.articulo-card--no-comprado .articulo-card__title {
  color: #b0b0b0;
  text-decoration: line-through;
  opacity: 0.5;
}
.articulo-card__head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 12px;
}
.articulo-card__index {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 0.72rem;
  font-weight: 700;
  color: #475569;
  background: #f1f5f9;
  letter-spacing: 0.02em;
}
.articulo-card__title-wrap {
  flex: 1;
  min-width: 0;
}
.articulo-card__code {
  display: inline-block;
  margin-bottom: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #334155;
  background: #e2e8f0;
}
.articulo-card__title {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 600;
  line-height: 1.4;
  color: #0f172a;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  cursor: default;
}
.articulo-card__link {
  flex-shrink: 0;
  margin-top: -2px;
}
.articulo-card__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}
.cotizar-codigo {
  font-weight: 700;
  white-space: nowrap;
  color: #334155;
}
@media (max-width: 960px) {
  .articulo-card__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.articulo-metric {
  padding: 8px 10px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  min-width: 0;
}
.articulo-metric--highlight {
  background: #fff;
  border-color: #e2e8f0;
}
.articulo-metric__label {
  display: block;
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  margin-bottom: 2px;
}
.articulo-metric__value {
  display: block;
  font-size: 0.9rem;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.articulo-metric__discount {
  display: inline-block;
  margin-left: 4px;
  font-size: 0.72rem;
  font-weight: 700;
  color: #b91c1c;
}
.articulo-card__quote-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}
.articulo-quote {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #fafcff;
  border: 1px dashed #dbeafe;
  min-height: 56px;
}
.articulo-quote__label {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
}
.articulo-quote__value {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  font-size: 0.92rem;
  font-weight: 600;
}
.articulo-quote__editor {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.articulo-quote__editor .v-text-field {
  flex: 1;
  min-width: 0;
}
.articulo-quote__proveedor {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.articulo-card__extras {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #f1f5f9;
}
.articulo-tag {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 600;
  color: #475569;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
}
.articulo-tag--info {
  color: #0369a1;
  background: #f0f9ff;
  border-color: #bae6fd;
}
.articulos-totals {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 14px;
  padding: 16px 18px;
  border-radius: 14px;
  background: linear-gradient(180deg, #eef2f7 0%, #f8fafc 100%);
  border: 1px solid #cbd5e1;
}
.articulos-totals__label {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #475569;
}
.articulos-totals__metrics {
  display: flex;
  gap: 24px;
}
@media (max-width: 600px) {
  .articulos-totals {
    flex-direction: column;
    align-items: flex-start;
  }
  .articulos-totals__metrics {
    width: 100%;
    justify-content: space-between;
  }
}
.articulos-totals__metric {
  text-align: right;
}
.articulos-totals__caption {
  display: block;
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  margin-bottom: 2px;
}
.articulos-totals__amount {
  font-size: 1.05rem;
  font-weight: 700;
  color: #0f172a;
}
.articulos-totals__discount {
  margin-left: 4px;
  font-size: 0.82rem;
}
.detail-notes {
  margin-top: 20px;
  padding: 16px 18px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}
.detail-notes.detail-notes--tab {
  margin-top: 0;
  padding: 4px 8px 8px;
  background: transparent;
  border: 0;
  border-radius: 0;
}
.detail-table-section .detail-section__title {
  margin-bottom: 14px;
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
}
.detail-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 920px;
}
.detail-table thead th {
  padding: 10px 12px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #64748b;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
.detail-table tbody td {
  padding: 12px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
  font-size: 0.875rem;
}
.detail-table tbody tr:last-child td {
  border-bottom: none;
}
.detail-table tbody tr:hover {
  background: #fafcff;
}
.detail-table__articulo {
  font-weight: 600;
  color: #0f172a;
}
.detail-table .num {
  text-align: right;
  white-space: nowrap;
}
.detail-table .actions {
  width: 56px;
  text-align: center;
}
.detail-table tfoot td {
  padding: 16px 14px 18px;
  background: linear-gradient(180deg, #eef2f7 0%, #f8fafc 100%);
  border-top: 2px solid #cbd5e1;
  vertical-align: middle;
}
.detail-table tfoot tr:last-child td:first-child {
  border-bottom-left-radius: 11px;
}
.detail-table tfoot tr:last-child td:last-child {
  border-bottom-right-radius: 11px;
}
.detail-table__totals-label {
  text-align: right;
  padding-right: 20px;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #475569;
}
.detail-table__totals-value {
  font-size: 1rem;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.3;
}
.detail-table__totals-value .detail-table__totals-caption {
  display: block;
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  margin-bottom: 2px;
}
.detail-table__totals-spacer {
  width: 56px;
  padding: 16px 8px 18px;
}
.detail-notice {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  border-radius: 12px;
  border: 1px solid transparent;
}
.detail-notice__icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.detail-notice strong {
  display: block;
  margin-bottom: 4px;
  font-size: 0.9rem;
}
.detail-notice p {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
}
.detail-notice--warning {
  background: #fffbeb;
  border-color: #fde68a;
}
.detail-notice--warning .detail-notice__icon {
  background: #fef3c7;
  color: #b45309;
}
.detail-notice--warning p {
  color: #78350f;
}
.detail-notice--info {
  background: #eff6ff;
  border-color: #bfdbfe;
}
.detail-notice--info .detail-notice__icon {
  background: #dbeafe;
  color: #1d4ed8;
}
.detail-notice--info p {
  color: #1e3a5f;
}

@media (max-width: 960px) {
  .detail-sections {
    grid-template-columns: 1fr;
  }
  .detail-grid {
    grid-template-columns: 1fr;
  }
}

.stamp{
  position:absolute;
  left:50%;
  top:50%;
  transform:translate(-50%,-50%) rotate(-15deg);
  font-weight:900;
  text-transform:uppercase;
  letter-spacing:2px;
  padding:12px 24px;
  border-width:6px;
  border-style:solid;
  border-radius:10px;
  font-size:64px;
  opacity:.22;
  pointer-events:none;
  z-index: 50;
  mix-blend-mode:multiply;
}
.stamp-won{
  color:#2e7d32;
  border-color:#2e7d32;
}
.stamp-lost{
  color:#c62828;
  border-color:#c62828;
}

/* Edición inline en tarjetas de artículo */
.editable-celda {
  position: relative;
}
.articulo-quote.editable-celda .edit-icon {
  visibility: hidden;
  opacity: 0;
  transition: opacity 160ms ease-out, visibility 160ms ease-out;
}
.articulo-quote.editable-celda:hover .edit-icon,
.articulo-card--editing .edit-icon {
  visibility: visible;
  opacity: 1;
}
.detail-table .editable-celda .edit-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  visibility: hidden;
  opacity: 0;
  transition: visibility 0s, opacity 0.3s ease-in-out;
}
.detail-table .editable-celda:hover .edit-icon {
  visibility: visible;
  opacity: 1;
}
/* Contenedor para alinear el checkbox y el texto */
.checkbox-container {
  display: flex;
  align-items: center; /* Centra verticalmente */
  justify-content: flex-end; /* Alinea el checkbox a la izquierda */
}

/* Estilos personalizados para el checkbox */
.custom-checkbox {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 2px solid #bdbdbd;
  background-color: white;
  display: inline-block;
  position: relative;
  transition: background-color 0.2s, border-color 0.2s;
  cursor: pointer;
}

.custom-checkbox:checked {
  background-color: #00bcd4;
  border-color: #00bcd4;
}

.custom-checkbox:checked::after {
  content: '✔';
  position: absolute;
  top: 2px;
  left: 5px;
  color: white;
  font-size: 16px;
}

.custom-checkbox:hover {
  background-color: rgba(0, 188, 212, 0.2);
  border-color: #00bcd4;
}

.custom-checkbox:focus {
  border-color: #00bcd4;
  box-shadow: 0 0 4px rgba(0, 188, 212, 0.5);
}

.custom-checkbox:disabled {
  background-color: #e0e0e0;
  border-color: #bdbdbd;
  cursor: not-allowed;
}

.custom-checkbox:disabled:checked {
  background-color: #9e9e9e;
  border-color: #9e9e9e;
}

.custom-checkbox:disabled:checked::after {
  color: #bdbdbd;
}

label {
  margin-left: 10px;
  cursor: pointer;
}
.precio-cotizado{ color:#b91c1c; font-weight:700; }

.obs-card{
  background:#FFF7D6;           /* amarillo claro */
  border:1px solid #FDE68A;     /* borde ámbar suave */
  border-radius:12px;
}
.obs-text{
  color:#6B4F2A;                /* marrón */
  text-align:center;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  font-weight:600;
}
.obs-icon{ font-size:20px; }
</style>
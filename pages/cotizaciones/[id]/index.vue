<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  collection, doc, onSnapshot, addDoc, updateDoc, getDocs, query, where, serverTimestamp
} from 'firebase/firestore'
import { useUserStore } from '~/stores/user'
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
const attachments = ref<any[]>([])

const SUPERVISOR_ROLE = 'jefe_comercial'
const supervisorEmail = ref<string|null>(null)

const dlgConfirmacionCompra = ref(false);  // Dialogo para confirmar compra
const articulosComprados = ref<any[]>([]);  // Artículos seleccionados como comprados
const comentarios = ref('');  // Comentarios adicionales


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
function getCounterpartyEmail(): string | null {
  const role = (user.rol || '').toLowerCase()
  const isSup = role === SUPERVISOR_ROLE || role.includes('vanes') || (user as any).esSupervisor === true
  if (isSup) return cot.value?.vendedor?.email || null
  if (role === 'comercial' || user.uid === cot.value?.vendedor?.uid) return supervisorEmail.value
  return cot.value?.vendedor?.email || supervisorEmail.value || null
}
const totalCotizado = computed(() => sumLineas(cot.value?.articulos || [], 'precioCliente'))

const isSupervisor = computed(() => {
  const r = (user.rol || '').toLowerCase()
  return r === 'admin' || r === 'jefe_comercial' || r.includes('vanes')
})
// --- roles/estados para bloquear tras cotizar ---
const isComercial = computed(() => (user.rol || '').toLowerCase() === 'comercial')
const isCotizada  = computed(() => (cot.value?.workflow || '').toLowerCase() === 'cotizado')
console.log(isCotizada)
const isGanada    = computed(() => (cot.value?.estado || '').toLowerCase() === 'ganada')
const isPerdida   = computed(() => (cot.value?.estado || '').toLowerCase() === 'perdida')

const isOwner = computed(() => user.uid && user.uid === (cot.value?.vendedor?.uid || cot.value?.vendedorUid))
const puedeAccionar = computed(() => isSupervisor.value)
function canSet(flow: 'en_revision'|'consultando'|'espera_cliente') {
  if (flow === 'espera_cliente') return Boolean(isOwner.value || isSupervisor.value)
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
onUnmounted(() => { 
  stopDoc?.(); stopComments?.() 
  stopAdjuntos?.()
})

// ===== Slack via Nuxt server API =====
async function notifySlack(text: string, toEmailOverride?: string | null) {
  try {
    const toEmail = toEmailOverride || getCounterpartyEmail()
    if (!toEmail) { console.warn('Slack: sin destinatario'); return }
    await $fetch('/api/slack/dm', { method:'POST', body:{ toEmail, text } })
  } catch (e:any) {
    console.error('Slack DM error:', e?.data || e)
  }
}

// ===== Acciones =====
async function addComment() {
  const texto = newComment.value.trim()
  if (!texto && !fileToUpload.value) return

  let attachment = null
  if (fileToUpload.value) {
    if (import.meta.server) return
    await ensureAuth()
    const path = `cotizaciones/${id.value}/attachments/${Date.now()}_${fileToUpload.value.name}`
    const fileRef = storageRef($storage, path)
    await uploadBytes(fileRef, fileToUpload.value)
    const url = await getDownloadURL(fileRef)
    attachment = { nombre: fileToUpload.value.name, url, tipo: fileToUpload.value.type }
  }

  await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
    texto: texto || null,
    attachment,
    fecha: serverTimestamp(),
    author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
  })

  newComment.value = ''
  fileToUpload.value = null
  await updateDoc(doc($db, 'cotizaciones', id.value), { updatedAt: serverTimestamp() })

  await notifySlack(`💬 ${user.nombre} comentó en la cotización “${cot.value?.nombre || cot.value?.cliente || id.value}”: “${texto}”`)
}

async function setWorkflow(flow: 'en_revision'|'consultando'|'espera_cliente') {
  if (!cot.value) return
  await updateDoc(doc($db, 'cotizaciones', id.value), { workflow: flow, updatedAt: serverTimestamp() })
  const msg = `🔄 ${user.nombre} cambió el estado de la cotización “${cot.value?.cliente || id.value}” a *${flow.replace('_',' ')}*.`
  if (isSupervisor.value) await notifySlack(msg, cot.value?.vendedor?.email)
  else if (flow === 'espera_cliente') await notifySlack(msg, supervisorEmail.value)
}

async function aceptar() {
  if (!cot.value) return
  await updateDoc(doc($db, 'cotizaciones', id.value), { estado: 'resuelta', updatedAt: serverTimestamp() })
  const msg = `✅ ${user.nombre} marcó la cotización “${cot.value?.cliente || id.value}” como *ACEPTADA*.`
  if (cot.value?.vendedor?.email) await notifySlack(msg, cot.value.vendedor.email)
  if (supervisorEmail.value) await notifySlack(msg, supervisorEmail.value)
}

async function loadComerciales() {
  try {
    const qRef = query(collection($db, 'usuarios'), where('rol', 'in', ['comercial', 'Comercial']))
    const snap = await getDocs(qRef)
    const lista = snap.docs.map(d => {
      const data = d.data()
      return {
        id: d.id,
        uid: data.uid || d.id,
        nombre: data.nombre || data.displayName || data.email || 'Sin nombre',
        email: data.email || null,
        rol: data.rol || 'comercial'
      }
    })
    const actualUid = cot.value?.vendedor?.uid
    comerciales.value = lista.filter((u:any) => u.uid !== actualUid)
  } catch (e) {
    console.error('[reasignar] Error cargando comerciales', e)
    comerciales.value = []
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
  const update: any = {
    vendedorAnterior: cot.value?.vendedor || null,
    vendedor: {
      uid: nuevo.uid,
      nombre: nuevo.nombre || nuevo.displayName || 'Comercial',
      email: nuevo.email || null,
      rol: nuevo.rol || 'comercial',
    },
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
    fecha: serverTimestamp(),
    author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
  })

  await notifySlack(`🔁 Cotización “${cot.value?.nombre || cot.value?.cliente || id.value}” reasignada a ${update.vendedor.nombre}`)
  showReassign.value = false
}

async function onFileChange(e:any) {
  const f = e.target.files?.[0]; if (!f) return
  if (import.meta.server) return
  await ensureAuth()
  const path = `cotizaciones/${id.value}/attachments/${Date.now()}_${f.name}`
  const fileRef = storageRef($storage, path)
  await uploadBytes(fileRef, f)
  const url = await getDownloadURL(fileRef)

  await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
    texto: null,
    attachment: { nombre: f.name, url, tipo: f.type },
    fecha: serverTimestamp(),
    author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
  })
  await updateDoc(doc($db, 'cotizaciones', id.value), { updatedAt: serverTimestamp() })
  await notifySlack(`📎 ${user.nombre} adjuntó “${f.name}” en la cotización “${cot.value?.nombre || cot.value?.cliente || id.value}”`)
}

// --- dialogs resultado ---
const dlgWin = ref(false)
const dlgLose = ref(false)

async function marcarGanada() {
  if (!cot.value) return;
  dlgConfirmacionCompra.value = true;
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
  });

  // Enviamos la notificación de Slack
  await notifySlack(`🙁 ${user.nombre} marcó la cotización “${cot.value?.cliente || id.value}” como *PERDIDA*`);

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
        comercial: cot.value.vendedor?.email, 
      },
    },
  });

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
        comercial: cot.value?.vendedor?.email || null,
      },
    },
  });

  // Enviar notificación de Slack
  await notifySlack(`🏆 La cotización #${cot.value.numero} para ${cot.value.cliente} ha sido ganada. Artículos confirmados: ${nuevosArticulos.filter((articulo: any) => articulo.comprado).map((articulo: any) => articulo.articulo).join(', ')}`, supervisorEmail.value);

  // Cerrar diálogo de confirmación de compra
  dlgConfirmacionCompra.value = false;

  // Mostrar el diálogo de "Enhorabuena" para que el comercial vea que la cotización fue ganada
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
  if (editIdx.value === null || !cot.value) return
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
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
    })
    //await notifySlack(`💶 ${msg} en la cotización “${cot.value?.cliente || id.value}”.`)

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
  } catch (e) {
    console.error('Error actualizando precio de coste:', e)
  } finally {
    cancelarEditorCoste()
  }
}


// --- popup cotizar ---
const showCotizar = ref(false)
type LineaCotizar = { articulo:string; unidades:number; precioCliente:number; precioCotizado:number|null }
const cotizarLineas = ref<LineaCotizar[]>([])
const cotizarObs = ref<string>('')

// abrir popup precargando líneas actuales
function abrirCotizar() {
  if (!cot.value) return
  cotizarLineas.value = (cot.value.articulos || []).map((a:any) => ({
    articulo: a.articulo || '',
    unidades: Number(a.unidades || 0),
    precioCliente: Number(a.precioCliente || 0),
    precioCotizado: (a.precioCotizado != null ? Number(a.precioCotizado) : null),
  }))
  cotizarObs.value = ''
  showCotizar.value = true
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

async function confirmarCotizacion() {
  if (!cot.value) return
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
      updatedAt: serverTimestamp(),
    })

    // 2) registrar comentario
    const msg = `🧾 Cotización cerrada: total tarifa € ${totalTarifaDlg.value.toFixed(2)} · total cotizado € ${totalCotizadoDlg.value.toFixed(2)}`
    await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
      texto: `${msg}${cotizarObs.value ? `\nObservaciones: ${cotizarObs.value}` : ''}`,
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
    })

    // 3) avisar por Slack
    await notifySlack(`✅ Se **cotizó** la cotización “${cot.value?.cliente || id.value}” el ${new Date().toLocaleString('es-ES')}. Total cotizado: € ${totalCotizadoDlg.value.toFixed(2)}.`)

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
  const articulos = (cot.value?.articulos || []).map((a:any) => ({
    articulo: a.articulo || '',
    url: a.url || '',
    unidades: Number(a.unidades || 0),
    precioCliente: Number(a.precioCliente || 0),        // tarifa
    precioSolicitado: a.precioSolicitado != null ? Number(a.precioSolicitado) : null,
    precioCompetencia: a.precioCompetencia != null ? Number(a.precioCompetencia) : null,
    precioCotizado: a.precioCotizado != null ? Number(a.precioCotizado) : null,
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
      stockDisponible: cot.value?.stockDisponible !== false, // true si no viene false explícito
      formaPagoSolicitada: cot.value?.formaPagoSolicitada || '',
      formaPagoActual: cot.value?.formaPagoActual || '',
      fechaDecision: cot.value?.fechaDecision || null,
      compradoAntes: !!cot.value?.compradoAntes,
      precioAnterior: cot.value?.precioAnterior ?? null,
      plazoEntrega: cot.value?.plazoEntrega || '',
      lugarEntrega: cot.value?.lugarEntrega || '',
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
        comercial: cot.value?.vendedor?.email || null,
        supervisor: supervisorEmail.value || null,
      }
    }
  })
} catch (e) {
  console.warn('[COTIZAR] notify warning:', e)
}

    showCotizar.value = false
  } catch (e) {
    console.error('Error al cotizar:', e)
  }
}
const showAdd = ref(false)
const nuevaLinea = reactive({
  articulo: '', url: '', unidades: 1,
  precioCliente: 0, precioSolicitado: null as number|null,
  precioCompetencia: null as number|null, precioCoste: null as number|null,
})

async function agregarLinea() {
  if (!cot.value) return
  const linea = {
    articulo: (nuevaLinea.articulo||'').trim(),
    url: (nuevaLinea.url||'').trim(),
    unidades: Number(nuevaLinea.unidades||1),
    precioCliente: Number(nuevaLinea.precioCliente||0),
    precioSolicitado: nuevaLinea.precioSolicitado!=null ? Number(nuevaLinea.precioSolicitado) : null,
    precioCompetencia: nuevaLinea.precioCompetencia!=null ? Number(nuevaLinea.precioCompetencia) : null,
    precioCoste: nuevaLinea.precioCoste!=null ? Number(nuevaLinea.precioCoste) : null,
  }
  const nuevas = [...(cot.value.articulos || []), linea]
  try {
    await updateDoc(doc($db, 'cotizaciones', id.value), {
      articulos: nuevas, updatedAt: serverTimestamp()
    })
    await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
      texto: `➕ ${user.nombre} añadió “${linea.articulo}” (${linea.unidades} uds).`,
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
    })
    
    if (user.isCompras) {
      if (!supervisorEmail.value) await loadSupervisor()
      await notifySlack(
        `➕ Compras añadió “${linea.articulo}” (${linea.unidades} uds) en la cotización #${cot.value?.numero} – ${cot.value?.cliente}.`,
        supervisorEmail.value || null
      )
    }

    showAdd.value = false
    Object.assign(nuevaLinea, { articulo:'', url:'', unidades:1, precioCliente:0, precioSolicitado:null, precioCompetencia:null, precioCoste:null })
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
              <template v-if="!isCotizada && !isGanada && !isPerdida">
                <v-chip :color="estadoChip(cot.estado).color" size="small" label>
                  {{ estadoChip(cot.estado).text }}
                </v-chip>
                <v-chip v-if="cot.workflow" color="info" size="small" label>
                  {{ cot.workflow === 'en_revision' ? 'En revisión'
                    : cot.workflow === 'consultando' ? 'Consultando proveedor'
                    : cot.workflow === 'espera_cliente' ? 'A la espera del cliente'
                    : cot.workflow }}
                </v-chip>
              </template>
              <v-chip v-if="isGanada || isPerdida" :color="isGanada ? 'success' : 'error'" size="small" label>
                {{ isGanada ? 'Ganada' : 'Perdida' }}
              </v-chip>
              <v-chip v-if="isCotizada" color="blue-darken-2" size="small" label>
                  Pendiente Cotización
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
                Total: € {{ totalCotizado.toFixed(2) }}
              </v-chip>
            </div>
          </div>
        </v-card>

        <v-row>
          <!-- IZQUIERDA: Comentarios -->
         <v-col cols="12" md="4">
            <v-card class="pa-4 d-flex flex-column comments-card">
              <!-- Input arriba -->
              <div class="d-flex align-center justify-space-between mb-2"> <h3 class="text-subtitle-1 font-weight-bold">Comentarios y actividad</h3> </div>
              <div class="comment-input-box">
                <v-textarea
                  v-model="newComment"
                  label="Escribe un comentario…"
                  rows="2"
                  auto-grow
                  variant="outlined"
                  hide-details
                />

                <div class="d-flex ga-2 mt-2 mb-2">
                  <v-btn color="primary" @click="addComment">
                    <template #prepend><Icon name="mdi:comment-plus-outline" class="me-1" /></template>
                    Añadir comentario
                  </v-btn>
                  <v-btn icon variant="plain" @click="$refs.fileInput.click()">
                    <Icon name="mdi:paperclip"/>
                  </v-btn>
                  <input type="file" ref="fileInput" class="d-none" @change="onFileChange" />
                </div>
              </div>

              <v-divider class="my-2" />

              <!-- Scroll SOLO en los comentarios -->
              <div class="comments-scroll">
                <div class="d-flex ga-3 mb-3">
                  <v-avatar :color="colorByRol(cot.vendedor?.rol, cot.vendedor?.nombre)" size="36">
                    {{ initials(cot.vendedor?.nombre || 'Vendedor') }}
                  </v-avatar>
                  <div>
                    <div class="text-body-2">
                      <strong>{{ cot.vendedor?.nombre || 'Vendedor' }}</strong>
                      ha creado esta cotización
                    </div>
                    <small class="text-medium-emphasis">
                      {{ fmt(cot.fechaCreacion || cot.fecha) }} · #{{ cot.numero }}
                      · € {{ totalCotizado.toFixed(2) }}
                    </small>
                  </div>
                </div>

                <div v-for="c in comments" :key="c.id" class="d-flex ga-3 mb-3">
                  <v-avatar :color="colorByRol(c.author?.rol, c.author?.nombre || c.user)" size="36">
                    {{ initials(c.author?.nombre || c.user || '—') }}
                  </v-avatar>
                  <div>
                    <div class="text-body-2">
                      <strong>{{ c.author?.nombre || c.user || '—' }}</strong>
                      <small class="text-medium-emphasis"> · {{ fmt(c.fecha) }}</small>
                    </div>
                    <div v-if="c.attachment" class="mt-2">
                      Ha adjuntado un documento: <br/><Icon name="mdi:paperclip"/>
                      <a :href="c.attachment.url" target="_blank" rel="noopener">
                        {{ c.attachment.nombre }}
                      </a>
                    </div>
                    <div class="mt-1">{{ c.texto }}</div>
                  </div>
                </div>
              </div>
            </v-card>
          </v-col>



          <!-- DERECHA: Detalles -->
          <v-col cols="12" md="8">
            <v-card class="pa-4">
              <!-- SELLOS -->
              <div v-if="isGanada" class="stamp stamp-won">GANADA</div>
              <div v-else-if="isPerdida" class="stamp stamp-lost">PERDIDA</div>
              <div class="d-flex justify-space-between align-center mb-4">
               <h3 class="text-subtitle-1 font-weight-bold mb-3">Detalles de la cotización</h3>
                <v-icon-btn color="blue-lighten-5" v-if="isOwner && !isGanada && !isPerdida" @click="navigateTo(`/cotizaciones/${id}/editar`)" class="text-primary">
                  <Icon name="mdi:pencil" class="text-xl" />
                </v-icon-btn>
                <v-icon-btn
                  v-if="canAñadirArticulo && !isCotizada && !isGanada && !isPerdida"
                  color="primary"
                  @click="showAdd=true"
                  :title="'Añadir artículo'"
                >
                  <Icon name="mdi:plus" class="text-xl" />
                </v-icon-btn>
              </div>

              <div class="d-flex flex-wrap ga-6 mb-4">
                <div>
                  <div class="text-medium-emphasis text-caption">Cliente</div>
                  <div class="font-weight-medium">{{ cot.cliente || '—' }}</div>
                </div>
                <div>
                  <div class="text-medium-emphasis text-caption">Vendedor</div>
                  <div class="font-weight-medium">{{ cot.vendedor?.nombre || '—' }}</div>
                </div>
                <div>
                  <div class="text-medium-emphasis text-caption">Tarifa</div>
                  <div class="font-weight-medium">{{ cot.tarifa || '—' }}</div>
                </div>
                <div>
                  <div class="text-medium-emphasis text-caption">Licitación</div>
                  <v-chip size="small" :color="(cot.licitacion ? 'primary' : 'grey')" label>
                    {{ cot.licitacion ? 'Sí' : 'No' }}
                  </v-chip>
                </div>
                <div>
                  <div class="text-medium-emphasis text-caption">Stock</div>
                  <v-chip size="small" :color="(cot.stockDisponible === false ? 'error' : 'success')" label>
                    {{ cot.stockDisponible === false ? 'Sin stock' : 'Con stock' }}
                  </v-chip>
                </div>

                <div v-if="cot.formaPagoSolicitada">
                  <div class="text-medium-emphasis text-caption">Forma de pago solicitada</div>
                  <div class="font-weight-medium">{{ cot.formaPagoSolicitada }}</div>
                </div>
                <div v-if="cot.formaPagoActual">
                  <div class="text-medium-emphasis text-caption">Forma de pago actual</div>
                  <div class="font-weight-medium">{{ cot.formaPagoActual }}</div>
                </div>
                <div>
                  <div class="text-medium-emphasis text-caption">Fecha de decisión</div>
                  <div class="font-weight-medium">{{ fmtDateStr(cot.fechaDecision) }}</div>
                </div>
                <div>
                  <div class="text-medium-emphasis text-caption">Comprado anteriormente</div>
                  <div class="font-weight-medium">{{ cot.compradoAntes ? 'Sí' : 'No' }}</div>
                </div>

                <div>
                  <div class="text-medium-emphasis text-caption">Precio anterior</div>
                  <div class="font-weight-medium">{{ cot.precioAnterior != null ? fmtMoney(cot.precioAnterior) : '—' }}</div>
                </div>
                <div v-if="cot.plazoEntrega">
                  <div class="text-medium-emphasis text-caption">Plazo de entrega</div>
                  <div class="font-weight-medium">{{ cot.plazoEntrega }}</div>
                </div>
                <div v-if="cot.lugarEntrega" class="w-100">
                  <div class="text-medium-emphasis text-caption">Lugar de entrega</div>
                  <div class="font-weight-medium">{{ cot.lugarEntrega }}</div>
                </div>
                <div v-if="cot.comentarioStock" class="w-100">
                  <div class="text-medium-emphasis text-caption">Comentario de stock</div>
                  <div>{{ cot.comentarioStock }}</div>
                </div>
                <div class="col-span-2 w-100" v-if="cot.comentariosCliente">
                  <div class="text-medium-emphasis text-caption">Comentarios del cliente</div>
                  <div>{{ cot.comentariosCliente }}</div>
                </div>
              </div>
              
              <v-table density="comfortable">
                <thead>
                  <tr>
                    <th>Artículo</th>
                    <th class="text-right">Unid.</th>
                    <th class="text-right">Precio Tarifa</th>
                    <th class="text-right">Solicitado</th>
                    <th class="text-right">Competencia</th>
                    <th class="text-right">Cotizado</th>
                    <th v-if="canEditarCoste" class="text-right">Total Coste</th>
                    <th class="text-right">Total (cliente)</th>
                    <th class="text-right">Total Cotizado</th>
                    <th class="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(a,i) in cot.articulos || []" :key="i" :class="{'articulo-no-comprado': !a.comprado && isGanada}">
                    <td>{{ a.articulo }}</td>
                    <td class="text-right">{{ a.unidades || 0 }}</td>
                    <td class="text-right">{{ (Number(a.precioCliente||0)).toFixed(2) }}€</td>
                    <td class="text-right">
                      <span v-if="a.precioSolicitado"> {{ (Number(a.precioSolicitado||0)).toFixed(2) }}€</span>
                      <span v-else>—</span>
                    </td>
                    <td class="text-right">
                      <span v-if="a.precioCompetencia"> {{ (Number(a.precioCompetencia||0)).toFixed(2) }}€</span>
                      <span v-else>—</span>
                    </td>
                    <td class="text-right editable-celda">
                      <!-- VISUAL normal cuando NO se está editando esta fila -->
                      <template v-if="editIdx !== i">
                        <span v-if="a.precioCotizado != null" class="precio-cotizado">
                          {{ (Number(a.precioCotizado||0)).toFixed(2) }}€
                        </span>
                        <span v-else>—</span>

                        <!-- Lápiz SOLO para Vanessa -->

                         <v-icon-btn v-if="isSupervisor && !isCotizada && !isGanada && !isPerdida" class="edit-icon" @click="abrirEditorPrecio(i)" :title="`Editar precio cotizado de ${a.articulo}`">
                            <Icon name="mdi:pencil" class="text-normal" />
                          </v-icon-btn>
                      </template>

                      <!-- EDITOR deslizante cuando esta fila está en edición -->
                      <v-slide-x-transition>
                        <div v-if="editIdx === i && !isCotizada && !isGanada && !isPerdida" class="d-inline-flex align-center ga-2">
                          <v-text-field
                            v-model.number="editCoste"
                            type="number" min="0" density="compact" variant="outlined" hide-details
                            style="min-width:120px" placeholder="0.00"
                          >
                            <template #append-inner><Icon name="mdi:currency-eur" /></template>
                          </v-text-field>
                          <v-icon-btn color="primary" @click="guardarEditorPrecio">
                            <Icon name="mdi:content-save" class="text-xl" />
                          </v-icon-btn>
                          <v-icon-btn color="error" @click="cancelarEditorPrecio">
                            <Icon name="mdi:close" class="text-xl" />
                          </v-icon-btn>
                        </div>
                      </v-slide-x-transition>
                    </td>
                    <!-- Campo de precio de coste (solo visible para supervisor) -->
                    <td v-if="canEditarCoste" class="text-right editable-celda">
                      <!-- VISUAL normal cuando NO se está editando esta fila -->
                      <template v-if="editIdx !== i">
                        <span v-if="a.precioCoste != null">
                          {{ (Number(a.precioCoste||0)).toFixed(2) }}€
                        </span>
                        <span v-else>—</span>

                        <!-- Lápiz SOLO para Vanessa -->

                         <v-icon-btn  v-if="canEditarCoste" class="edit-icon" @click="abrirEditorCoste(i)" :title="`Editar precio coste de ${a.articulo}`">
                            <Icon name="mdi:pencil" class="text-normal" />
                          </v-icon-btn>
                      </template>

                      <!-- EDITOR deslizante cuando esta fila está en edición -->
                      <v-slide-x-transition>
                        <div v-if="editCosteIdx === i" class="d-inline-flex align-center ga-2">
                          <v-text-field
                            v-model.number="editCoste"
                            type="number"
                            min="0"
                            density="compact"
                            variant="outlined"
                            hide-details
                            style="min-width:120px"
                            placeholder="0.00"
                          >
                            <template #append-inner><Icon name="mdi:currency-eur" /></template>
                          </v-text-field>
                          
                          <v-icon-btn color="primary" @click="guardarEditorPrecioCoste">
                            <Icon name="mdi:content-save" class="text-s" />
                          </v-icon-btn>
                          <v-icon-btn color="error" @click="cancelarEditorCoste">
                            <Icon name="mdi:close" class="text-xl" />
                          </v-icon-btn>
                        </div>
                      </v-slide-x-transition>
                    </td>
                    <td class="text-right">
                      {{ ((Number(a.unidades||0)*Number(a.precioCliente||0))).toFixed(2) }} €
                    </td>
                    <td class="text-right">
                       {{ ((Number(a.unidades||0)*Number(a.precioCotizado||0))).toFixed(2) }}€
                    </td>
                    <td class="text-right">
                      <v-btn :href="a.url || undefined" :disabled="!a.url" target="_blank" rel="noopener" variant="tonal" color="primary" size="small">
                        <template #prepend><Icon name="mdi:open-in-new" class="me-1" /></template>
                        Ver artículo en web
                      </v-btn>
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </v-card>
            <v-card v-if="cot.cotizadoObs" class="pa-4 mt-4 obs-card">
              <div class="d-flex align-center justify-space-between mb-2">
                <h3 class="text-subtitle-1 font-weight-bold">Observaciones de cotización</h3>
              </div>
              <v-card-text class="obs-text">
                <Icon name="mdi-alert-circle-outline" class="obs-icon" />
                {{ cot.cotizadoObs }}
              </v-card-text>
            </v-card>
            <v-card class="pa-4 mt-4">
              <div class="d-flex align-center justify-space-between mb-2">
                <h3 class="text-subtitle-1 font-weight-bold">Adjuntos</h3>
                <v-chip size="small" variant="tonal">{{ attachments.length }}</v-chip>
              </div>

              <div v-if="!attachments.length" class="text-medium-emphasis">
                Sin adjuntos.
              </div>

              <v-list v-else density="comfortable">
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
            </v-card>
            <!-- Acciones -->
            <div class="d-flex ga-3 mt-6">

            <!-- Antes de cotizar: solo Supervisor puede mover workflow / cotizar -->
            <template v-if="!isCotizada && !isGanada && !isPerdida">
              <v-btn v-if="isSupervisor" :disabled="cot.workflow === 'en_revision'" color="warning" @click="setWorkflow('en_revision')">
                <template #prepend><Icon name="mdi:eye" class="me-2" /></template>En revisión
              </v-btn>

              <v-btn v-if="isSupervisor" :disabled="cot.workflow === 'consultando'" color="info" @click="setWorkflow('consultando')">
                <template #prepend><Icon name="mdi:truck" class="me-2" /></template>Consultando proveedor
              </v-btn>

              <v-btn v-if="(isSupervisor || isOwner) && !isCotizada" :disabled="cot.workflow === 'espera_cliente'" color="secondary" @click="setWorkflow('espera_cliente')">
                <template #prepend><Icon name="mdi:account-clock" class="me-2" /></template>A la espera del cliente
              </v-btn>

              <v-spacer />

              <v-btn v-if="isSupervisor" color="success" @click="abrirCotizar">
                <template #prepend><Icon name="mdi:cash-check" class="me-2" /></template>Cotizar
              </v-btn>

              <v-btn v-if="isSupervisor" color="secondary" @click="abrirReasignar">
                <template #prepend><Icon name="mdi:account-switch" class="me-2" /></template>Reasignar
              </v-btn>
            </template>

            <!-- Tras cotizar: SOLO el comercial puede marcar Ganada/Perdida -->
            <template v-else-if="isCotizada && !isGanada && !isPerdida">
              <v-alert type="info" variant="tonal" class="mr-auto">
                Cotización cerrada. Pendiente de resultado.
              </v-alert>
              <v-btn v-if="isOwner" color="success" @click="marcarGanada">
                <template #prepend><Icon name="mdi:trophy" class="me-2" /></template>GANADA
              </v-btn>
              <v-btn v-if="isOwner" color="error" @click="marcarPerdida">
                <template #prepend><Icon name="mdi:emoticon-sad-outline" class="me-2" /></template>PERDIDA
              </v-btn>
            </template>

            <!-- Estado final -->
            <template v-else>
              <v-alert :type="isGanada ? 'success' : 'error'" variant="tonal" class="mr-auto">
                {{ isGanada ? 'Esta cotización fue GANADA.' : 'Esta cotización fue PERDIDA.' }}
              </v-alert>
            </template>
            </div>

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

        <!-- DIALOGO COTIZAR -->
        <v-dialog v-model="showCotizar" max-width="880">
          <v-card>
            <v-card-title class="text-h6">
              Cotizar – {{ cot?.cliente || '—' }}
            </v-card-title>

            <v-card-text>
              <v-table density="comfortable">
                <thead>
                  <tr>
                    <th>Artículo</th>
                    <th class="text-right">Unid.</th>
                    <th class="text-right">Precio tarifa</th>
                    <th class="text-right">Precio cotizado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(l, i) in cotizarLineas" :key="i">
                    <td style="max-width:340px">{{ l.articulo }}</td>
                    <td class="text-right">{{ l.unidades }}</td>
                    <td class="text-right">{{ (Number(l.precioCliente)||0).toFixed(2) }} €</td>
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
                <v-chip color="success" variant="tonal">Total cotizado: € {{ totalCotizadoDlg.toFixed(2) }}</v-chip>
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
                Confirmar cotización
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
            <img src="https://media.giphy.com/media/111ebonMs90YLu/giphy.gif" alt="Congrats" style="width:100%;border-radius:8px;" />
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
            <img src="https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExcWVpdzFzZ21kZnk4ODBjM3E2cHNzcDRnMWE5NHFpZDVpY292azZwdSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/4V3RuU0zSq1SC8Hh4x/giphy.gif" alt="Sad" style="width:100%;border-radius:8px;" />
            <div class="mt-3">La cotización se ha marcado como <strong>PERDIDA</strong>.</div>
            <v-card-actions class="mt-2"><v-spacer/><v-btn color="primary" @click="dlgLose=false">Cerrar</v-btn></v-card-actions>
          </v-card>
        </v-dialog>

        <!-- DIALOGO AÑADIR ARTÍCULO -->
        <v-dialog v-model="showAdd" max-width="640">
          <v-card>
            <v-card-title class="text-h6">Añadir artículo</v-card-title>
            <v-card-text>
              <v-row dense>
                <v-col cols="12"><v-text-field v-model="nuevaLinea.articulo" label="Artículo" variant="outlined" hide-details required /></v-col>
                <v-col cols="12"><v-text-field v-model="nuevaLinea.url" label="URL (opcional)" variant="outlined" hide-details /></v-col>
                <v-col cols="6"><v-text-field v-model.number="nuevaLinea.unidades" type="number" min="1" label="Unidades" variant="outlined" hide-details /></v-col>
                <v-col cols="6"><v-text-field v-model.number="nuevaLinea.precioCliente" type="number" min="0" step="0.01" label="Precio tarifa" variant="outlined" hide-details /></v-col>
                <v-col cols="6"><v-text-field v-model.number="nuevaLinea.precioSolicitado" type="number" min="0" step="0.01" label="Precio solicitado (opcional)" variant="outlined" hide-details /></v-col>
                <v-col cols="6"><v-text-field v-model.number="nuevaLinea.precioCompetencia" type="number" min="0" step="0.01" label="Precio competencia (opcional)" variant="outlined" hide-details /></v-col>
                <v-col cols="6"><v-text-field v-model.number="nuevaLinea.precioCoste" type="number" min="0" step="0.01" label="Precio coste (opcional)" variant="outlined" hide-details /></v-col>
              </v-row>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" @click="showAdd=false">Cancelar</v-btn>
              <v-btn color="primary" :disabled="!nuevaLinea.articulo" @click="agregarLinea">Añadir</v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>


      </template>
    </template>
  </v-container>
</template>
<style scoped>
.comments-card {
  height: 66vh; /* altura total del card */
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
  opacity:.18;
  pointer-events:none;
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

/* Estilo para mostrar el icono de editar solo al hacer hover */
.editable-celda {
  position: relative; /* Necesario para que los elementos hijos con `position: absolute` se posicionen respecto a esta celda */
}

/* El icono de editar se oculta por defecto */
.editable-celda .edit-icon {
  position: absolute;
  top: 50%; /* Centrado verticalmente */
  left: 50%; /* Centrado horizontalmente */
  transform: translate(-50%, -50%); /* Ajusta la posición para centrarlo perfectamente */
  visibility: hidden; /* Oculto por defecto */
  opacity: 0; /* Transparente por defecto */
  transition: visibility 0s, opacity 0.3s ease-in-out; /* Transición para hacerlo visible suavemente */
}

/* El icono de editar solo aparece cuando se hace hover sobre la celda */
.editable-celda:hover .edit-icon {
  visibility: visible; /* Hacerlo visible */
  opacity: 1; /* Hacerlo opaco */
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
.articulo-no-comprado {
  color: #b0b0b0; 
  text-decoration: line-through; 
  opacity: 0.5;
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
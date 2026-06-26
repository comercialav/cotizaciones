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
// --- roles/estados para bloquear tras cotizar ---
const isComercial = computed(() => (user.rol || '').toLowerCase() === 'comercial')
const isCotizada  = computed(() => (cot.value?.workflow || '').toLowerCase() === 'cotizado')
const isGanada    = computed(() => (cot.value?.estado || '').toLowerCase() === 'ganada')
const isPerdida   = computed(() => (cot.value?.estado || '').toLowerCase() === 'perdida')

const isOwner = computed(() => user.uid && user.uid === (cot.value?.vendedor?.uid || cot.value?.vendedorUid))
const puedeAccionar = computed(() => isSupervisor.value)
const canEditarPrecioCotizado = computed(() => isSupervisor.value && !isGanada.value && !isPerdida.value)
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
async function notifySlack(text: string, event: string, toEmailOverride?: string | null) {
  try {
    const toEmail = toEmailOverride || getCounterpartyEmail()
    if (!toEmail) { console.warn('Slack: sin destinatario'); return }
    await $fetch('/api/slack/dm', { method:'POST', body:{ toEmail, text, event } })
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
  if (isSupervisor.value) {
    showVisibilityDialog.value = true;
  } else {
    commentVisibility.value = user.rol === 'compras' ? 'privado' : 'publico';
    addComment();
  }
}
async function addComment() {
  const texto = newComment.value.trim();
  if (!texto && !fileToUpload.value) return;

  const visibilidadGuardada = commentVisibility.value
  const articuloGuardado = selectedArticulo.value
  let attachment = null;

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
  selectedArticulo.value = null;
  commentVisibility.value = 'publico';

  if (visibilidadGuardada === 'privado') {
    if (isSupervisor.value) {
      await $fetch('/api/notify', {
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
    } else {
      const msg = `💬 Nuevo comentario privado sobre el artículo "${articuloGuardado}": "${texto}"`;
      await notifySlack(msg, 'comentario_privado', supervisorEmail.value);
    }
  } else {
    const msg = `💬 ${user.nombre} comentó en la cotización “${cot.value?.nombre || cot.value?.cliente || id.value}”: “${texto}”`;
    await notifySlack(msg, 'comentario_publico');
  }

  await updateDoc(doc($db, 'cotizaciones', id.value), { updatedAt: serverTimestamp() });
}

const filteredComments = computed(() => {
  return comments.value.filter(c => c.visibilidad === 'publico' || isSupervisor.value || (user.rol === 'compras' && c.visibilidad === 'privado'));
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
  if (/^(Recotización confirmada|Cotización cerrada|Reasignada|marcada como|El comercial ha editado)/i.test(t)) return true
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



async function setWorkflow(flow: 'en_revision'|'consultando'|'espera_cliente') {
  if (!cot.value) return
  await updateDoc(doc($db, 'cotizaciones', id.value), { workflow: flow, updatedAt: serverTimestamp() })
  const msg = `🔄 ${user.nombre} cambió el estado de la cotización “${cot.value?.cliente || id.value}” a *${flow.replace('_',' ')}*.`
  if (isSupervisor.value) await notifySlack(msg, 'workflow', cot.value?.vendedor?.email)
  else if (flow === 'espera_cliente') await notifySlack(msg, 'workflow', supervisorEmail.value)
}

async function aceptar() {
  if (!cot.value) return
  await updateDoc(doc($db, 'cotizaciones', id.value), { estado: 'resuelta', updatedAt: serverTimestamp() })
  const msg = `✅ ${user.nombre} marcó la cotización “${cot.value?.cliente || id.value}” como *ACEPTADA*.`
  if (cot.value?.vendedor?.email) await notifySlack(msg, 'workflow', cot.value.vendedor.email)
  if (supervisorEmail.value) await notifySlack(msg, 'workflow', supervisorEmail.value)
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
    tipo: 'actividad',
    fecha: serverTimestamp(),
    author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
  })

  await notifySlack(`🔁 Cotización “${cot.value?.nombre || cot.value?.cliente || id.value}” reasignada a ${update.vendedor.nombre}`, 'reasignacion')
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
    tipo: 'actividad',
    fecha: serverTimestamp(),
    author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
  })
  await updateDoc(doc($db, 'cotizaciones', id.value), { updatedAt: serverTimestamp() })
  await notifySlack(`📎 ${user.nombre} adjuntó “${f.name}” en la cotización “${cot.value?.nombre || cot.value?.cliente || id.value}”`, 'adjunto')
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
  await notifySlack(`🏆 La cotización #${cot.value.numero} para ${cot.value.cliente} ha sido ganada. Artículos confirmados: ${nuevosArticulos.filter((articulo: any) => articulo.comprado).map((articulo: any) => articulo.articulo).join(', ')}`, 'ganada', supervisorEmail.value);

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
      tipo: 'actividad',
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
    })
    if (isCotizada.value) {
      await notifySlack(`${msg} en la cotización “${cot.value?.cliente || id.value}”.`, 'precio_cotizado', cot.value?.vendedor?.email || null)
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
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
    })
  } catch (e) {
    console.error('Error actualizando precio de coste:', e)
  } finally {
    cancelarEditorCoste()
  }
}


// --- popup cotizar ---
const showCotizar = ref(false)
const modoRecotizar = ref(false)
type LineaCotizar = { articulo:string; unidades:number; precioCliente:number; precioCotizado:number|null }
const cotizarLineas = ref<LineaCotizar[]>([])
const cotizarObs = ref<string>('')

// --- popup solicitar recotización (comercial) ---
const showRecotizar = ref(false)
const recotizarMotivo = ref('')

function abrirCotizar(recotizar = false) {
  if (!cot.value) return
  const yaCotizada = (cot.value.articulos || []).some((a: any) => a.precioCotizado != null)
  modoRecotizar.value = recotizar || yaCotizada
  cotizarLineas.value = (cot.value.articulos || []).map((a:any) => ({
    articulo: a.articulo || '',
    unidades: Number(a.unidades || 0),
    precioCliente: Number(a.precioCliente || 0),
    precioCotizado: (a.precioCotizado != null ? Number(a.precioCotizado) : null),
  }))
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

    const msg = `🔄 ${user.nombre} solicita recotización de “${cot.value?.cliente || id.value}”${motivo ? `: ${motivo}` : ''}.`
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
    await notifySlack(slackMsg, 'cotizada', cot.value?.vendedor?.email || null)

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
      tipo: 'actividad',
      fecha: serverTimestamp(),
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
    })
    
    if (user.isCompras) {
      if (!supervisorEmail.value) await loadSupervisor()
      await notifySlack(
        `➕ Compras añadió “${linea.articulo}” (${linea.unidades} uds) en la cotización #${cot.value?.numero} – ${cot.value?.cliente}.`,
        'linea_compras',
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
                <div class="d-flex align-center ga-2">
                  <v-btn color="primary" size="small" @click="onAddCommentClick">
                    <template #prepend><Icon name="mdi:send" class="me-1" /></template>
                    Enviar
                  </v-btn>
                  <v-btn icon variant="text" size="small" @click="$refs.fileInput.click()" title="Adjuntar archivo">
                    <Icon name="mdi:paperclip"/>
                  </v-btn>
                  <input type="file" ref="fileInput" class="d-none" @change="onFileChange" />
                </div>
              </div>

              <v-dialog v-model="showVisibilityDialog" max-width="420px">
                <v-card>
                  <v-card-title class="text-h6">Visibilidad del comentario</v-card-title>
                  <v-card-text>
                    <p class="mb-0">¿Lo publicas para todos o solo para compras?</p>
                  </v-card-text>
                  <v-card-actions>
                    <v-spacer />
                    <v-btn variant="tonal" @click="setCommentVisibility('publico')">Público</v-btn>
                    <v-btn color="primary" @click="setCommentVisibility('privado')">Privado</v-btn>
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
                        Privado
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
          <v-col cols="12" md="8">
            <v-card class="detail-card">
              <div v-if="isGanada" class="stamp stamp-won">GANADA</div>
              <div v-else-if="isPerdida" class="stamp stamp-lost">PERDIDA</div>

              <div class="detail-card__header">
                <div>
                  <p class="detail-eyebrow">Cotización #{{ cot.numero || '—' }}</p>
                  <h3 class="detail-title">Detalles</h3>
                </div>
                <div class="detail-card__actions">
                  <v-btn
                    v-if="isOwner && !isGanada && !isPerdida"
                    variant="tonal"
                    color="primary"
                    size="small"
                    @click="navigateTo(`/cotizaciones/${id}/editar`)"
                  >
                    <template #prepend><Icon name="mdi:pencil" /></template>
                    Editar
                  </v-btn>
                  <v-btn
                    v-if="canAñadirArticulo && !isCotizada && !isGanada && !isPerdida"
                    variant="tonal"
                    color="primary"
                    size="small"
                    @click="showAdd = true"
                  >
                    <template #prepend><Icon name="mdi:plus" /></template>
                    Artículo
                  </v-btn>
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
                      <dd>{{ cot.tarifa || '—' }}</dd>
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
                    <div class="detail-field">
                      <dt>Comprado antes</dt>
                      <dd>{{ cot.compradoAntes ? 'Sí' : 'No' }}</dd>
                    </div>
                    <div class="detail-field">
                      <dt>Precio anterior</dt>
                      <dd>{{ cot.precioAnterior != null ? fmtMoney(cot.precioAnterior) : '—' }}</dd>
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
                        <v-chip size="x-small" :color="cot.stockDisponible === false ? 'error' : 'success'" label>
                          {{ cot.stockDisponible === false ? 'Sin stock' : 'Con stock' }}
                        </v-chip>
                      </dd>
                    </div>
                    <div class="detail-field">
                      <dt>Plazo entrega</dt>
                      <dd>{{ cot.plazoEntrega || '—' }}</dd>
                    </div>
                    <div class="detail-field detail-field--wide">
                      <dt>Lugar entrega</dt>
                      <dd>{{ cot.lugarEntrega || '—' }}</dd>
                    </div>
                  </dl>
                </section>

                <section
                  v-if="cot.comentarioStock || cot.comentariosCliente"
                  class="detail-section detail-section--full"
                >
                  <h4 class="detail-section__title">
                    <Icon name="mdi:text-box-outline" />
                    Notas
                  </h4>
                  <dl class="detail-grid detail-grid--notes">
                    <div v-if="cot.comentarioStock" class="detail-field detail-field--wide">
                      <dt>Comentario de stock</dt>
                      <dd>{{ cot.comentarioStock }}</dd>
                    </div>
                    <div v-if="cot.comentariosCliente" class="detail-field detail-field--wide">
                      <dt>Comentarios del cliente</dt>
                      <dd>{{ cot.comentariosCliente }}</dd>
                    </div>
                  </dl>
                </section>
              </div>

              <div class="detail-table-section">
                <h4 class="detail-section__title">
                  <Icon name="mdi:package-variant-closed" />
                  Artículos
                </h4>
                <div class="table-wrap">
                  <table class="detail-table">
                    <thead>
                      <tr>
                        <th>Artículo</th>
                        <th class="num">Unid.</th>
                        <th class="num">Tarifa</th>
                        <th class="num">Solicitado</th>
                        <th class="num">Competencia</th>
                        <th class="num">Cotizado</th>
                        <th v-if="canEditarCoste" class="num">Coste</th>
                        <th class="num">Total cliente</th>
                        <th class="num">Total cotizado</th>
                        <th class="actions">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(a, i) in cot.articulos || []"
                        :key="i"
                        :class="{ 'articulo-no-comprado': !a.comprado && isGanada }"
                      >
                        <td class="detail-table__articulo">{{ a.articulo }}</td>
                        <td class="num">{{ a.unidades || 0 }}</td>
                        <td class="num">{{ fmtMoney(Number(a.precioCliente || 0)) }}</td>
                        <td class="num">
                          <span v-if="a.precioSolicitado">{{ fmtMoney(Number(a.precioSolicitado || 0)) }}</span>
                          <span v-else class="text-medium-emphasis">—</span>
                        </td>
                        <td class="num">
                          <span v-if="a.precioCompetencia">{{ fmtMoney(Number(a.precioCompetencia || 0)) }}</span>
                          <span v-else class="text-medium-emphasis">—</span>
                        </td>
                        <td class="num editable-celda">
                      <!-- VISUAL normal cuando NO se está editando esta fila -->
                      <template v-if="editIdx !== i">
                        <span v-if="a.precioCotizado != null" class="precio-cotizado">
                              {{ fmtMoney(Number(a.precioCotizado || 0)) }}
                            </span>
                            <span v-else class="text-medium-emphasis">—</span>

                        <!-- Lápiz SOLO para Vanessa -->

                         <v-icon-btn v-if="canEditarPrecioCotizado" class="edit-icon" @click="abrirEditorPrecio(i)" :title="`Editar precio cotizado de ${a.articulo}`">
                            <Icon name="mdi:pencil" class="text-normal" />
                          </v-icon-btn>
                      </template>

                      <!-- EDITOR deslizante cuando esta fila está en edición -->
                      <v-slide-x-transition>
                        <div v-if="editIdx === i && canEditarPrecioCotizado" class="d-inline-flex align-center ga-2">
                          <v-text-field
                            v-model.number="editValor"
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
                    <td v-if="canEditarCoste" class="num editable-celda">
                      <!-- VISUAL normal cuando NO se está editando esta fila -->
                      <template v-if="editCosteIdx !== i">
                        <span v-if="a.precioCoste != null">
                          {{ fmtMoney(Number(a.precioCoste || 0)) }}
                        </span>
                        <span v-else class="text-medium-emphasis">—</span>

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
                        <td class="num">{{ fmtMoney((Number(a.unidades || 0) * Number(a.precioCliente || 0))) }}</td>
                        <td class="num">
                          <template v-if="a.precioCotizado != null">
                            <span>{{ fmtMoney((Number(a.unidades || 0) * Number(a.precioCotizado || 0))) }}</span>
                            <span v-if="descuentoLinea(a) != null" class="precio-cotizado ms-1">
                              ({{ descuentoLinea(a)!.toFixed(1) }}%)
                            </span>
                          </template>
                          <span v-else class="text-medium-emphasis">—</span>
                        </td>
                        <td class="actions">
                          <v-btn
                            :href="a.url || undefined"
                            :disabled="!a.url"
                            target="_blank"
                            rel="noopener"
                            variant="text"
                            color="primary"
                            size="small"
                            icon
                            title="Ver artículo en web"
                          >
                            <Icon name="mdi:open-in-new" />
                          </v-btn>
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr class="detail-table__totals">
                        <td :colspan="canEditarCoste ? 7 : 6" class="detail-table__totals-label">Totales</td>
                        <td class="num detail-table__totals-value">
                          <span class="detail-table__totals-caption">Total cliente</span>
                          {{ fmtMoney(totalCotizado) }}
                        </td>
                        <td class="num detail-table__totals-value">
                          <span class="detail-table__totals-caption">Total cotizado</span>
                          <span v-if="totalPrecioCotizado != null" class="precio-cotizado">
                            {{ fmtMoney(totalPrecioCotizado) }}
                            <span v-if="descuentoGlobal != null"> ({{ descuentoGlobal.toFixed(1) }}%)</span>
                          </span>
                          <span v-else class="text-medium-emphasis">—</span>
                        </td>
                        <td class="detail-table__totals-spacer" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </v-card>
            <v-card
              v-if="cot.recotizarMotivo && !isCotizada && !isGanada && !isPerdida"
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
            <v-card class="pa-4 mt-4 activity-card">
              <div class="d-flex align-center justify-space-between mb-3">
                <h3 class="text-subtitle-1 font-weight-bold mb-0">Historial de actividad</h3>
                <v-chip size="x-small" variant="tonal">{{ activityTimeline.length }}</v-chip>
              </div>
              <div class="activity-scroll">
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

            <!-- Tras cotizar: comercial marca Ganada/Perdida o solicita recotización -->
            <template v-else-if="isCotizada && !isGanada && !isPerdida">
              <v-alert type="info" variant="tonal" class="mr-auto">
                Cotización cerrada. Pendiente de resultado.
              </v-alert>
              <v-btn v-if="isOwner" color="warning" variant="tonal" @click="abrirRecotizar">
                <template #prepend><Icon name="mdi:refresh" class="me-2" /></template>Solicitar recotización
              </v-btn>
              <v-btn v-if="isSupervisor" color="warning" @click="abrirCotizar(true)">
                <template #prepend><Icon name="mdi:cash-check" class="me-2" /></template>Recotizar
              </v-btn>
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
        <v-dialog v-model="showCotizar" max-width="880">
          <v-card>
            <v-card-title class="text-h6">
              {{ modoRecotizar ? 'Recotizar' : 'Cotizar' }} – {{ cot?.cliente || '—' }}
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
.detail-layout {
  align-items: flex-start;
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
  padding: 20px 24px;
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
.detail-table-section {
  padding: 0 24px 24px;
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
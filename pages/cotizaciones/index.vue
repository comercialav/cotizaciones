<script setup lang="ts">
definePageMeta({
  middleware: ['role-comercial']
})

import { useUserStore } from '~/stores/user'
import { useCotizacionesStore } from '~/stores/cotizaciones'
import { normalizeStockEstado, stockEstadoLabel, stockChipColor, stockNeedsCompras, pendienteStripState, pendienteEnColaCompras } from '~/utils/stock'
import { fetchCotizacionesForScope } from '~/utils/cotizacion-access'
import { tarifaLabel } from '~/utils/tarifas'
import { filterComercialesList, PENDIENTE_COMPRAS_FILTER_UID, isPendienteComprasFilterUid } from '~/utils/comerciales'
import { workflowLabelShort, workflowBadgeLabel, workflowBadgeColor, comercialHaRespondidoEspera } from '~/utils/workflow'
import { htmlToPlainText, looksLikeHtml } from '~/utils/format-text'
import { readUserBool, writeUserBool } from '~/utils/user-preference'
import {
  collection, query, where, orderBy, limit, getDocs, startAfter, DocumentSnapshot
} from 'firebase/firestore'

const { $db } = useNuxtApp()
const route = useRoute()
const user = useUserStore()
const store = useCotizacionesStore()

// --- Roles / supervisor ---
const isSupervisor = computed(()=> user.isSupervisor || user.isCompras)

// --- Comerciales (para el select de la supervisora) ---
const comerciales = ref<{ uid:string; authUid?:string; legacyUid?:string; nombre:string; email?:string }[]>([])
const selectedComercialUid = ref<string | null>(null)

const comercialesFilterItems = computed(() => [
  { uid: null, nombre: 'Todos los comerciales' },
  { uid: PENDIENTE_COMPRAS_FILTER_UID, nombre: 'Pendiente de Compras' },
  ...comerciales.value,
])

const filtroPendienteComprasActivo = computed(() =>
  isSupervisor.value && isPendienteComprasFilterUid(selectedComercialUid.value),
)

async function loadComerciales(){
  try{
    const qs = await getDocs(
      query(collection($db,'usuarios'), where('rol','==','comercial'))
    )

    comerciales.value = qs.docs
      .map(d=>{
        const data = d.data() as any
        const authUid = data.authUid || d.id
        const legacyUid = data.uid && data.uid !== authUid ? data.uid : null
        return {
          uid: authUid,
          authUid,
          legacyUid,
          nombre: data.nombre || data.displayName || 'Comercial',
          email: data.email || null
        }
      })
      .filter(c => !!c.uid)

    comerciales.value = filterComercialesList(comerciales.value)

  }catch(e){
    console.error('[comerciales] error', e)
    comerciales.value = []
  }
}

// UI
const loading = ref(true)
const search  = ref('')

type FiltroClave = 'all' | 'Pendiente' | 'Reabiertas' | 'SinRevisar' | 'Cotizadas' | 'Ganadas' | 'Perdidas' | 'Aplazadas'

function deriveUI(c: any) {
  const estado = String(c.estado || '').toLowerCase()
  const workflow = String(c.workflow || '').toLowerCase()

  const isGanada   = estado === 'ganada'
  const isPerdida  = estado === 'perdida'
  const isAplazada = estado === 'aplazada'
  const isReab     = estado === 'reabierta'
  const isCotizada = workflow === 'cotizado'

  let uiProgress = 0
  if (isGanada || isPerdida || isAplazada) uiProgress = 100
  else if (workflow === 'cotizado') uiProgress = 80
  else if (workflow === 'espera_cliente' || workflow === 'espera_comercial') uiProgress = 60
  else if (workflow === 'consultando' || workflow === 'consultando_compras') uiProgress = 40
  else if (workflow === 'en_revision') uiProgress = 20

  const uiColor =
    isGanada  ? 'green-darken-2' :
    isPerdida ? 'red-darken-2'   :
    isAplazada ? 'grey-darken-1' :
    workflow === 'cotizado' ? 'blue-darken-2' :
    workflow === 'espera_cliente' || workflow === 'espera_comercial' ? 'lime-darken-2' :
    workflow === 'consultando' || workflow === 'consultando_compras' ? 'yellow-darken-2' :
    workflow === 'en_revision' ? 'amber-darken-2' : 'amber-darken-2'

  const uiHidePend = uiProgress === 100

  const uiFiltro: Exclude<FiltroClave,'all'|'Pendiente'> =
    isGanada   ? 'Ganadas'    :
    isPerdida  ? 'Perdidas'   :
    isAplazada ? 'Aplazadas'  :
    isCotizada ? 'Cotizadas'  :
    isReab     ? 'Reabiertas' :
                 'SinRevisar'

  // Badge de estado (visible para todos los roles)
  const workflowBadge = workflowBadgeLabel(workflow)
  const uiBadge =
    isGanada   ? 'Ganada'    :
    isPerdida  ? 'Perdida'   :
    isAplazada ? 'Aplazada'  :
    isCotizada ? 'Cotizada'  :
    workflowBadge ||
    (isReab     ? 'Reabierta' : 'Pendiente')

  const uiBadgeColor =
    isGanada  ? 'green-darken-2' :
    isPerdida ? 'red-darken-2'   :
    isAplazada ? 'grey-darken-1' :
    isCotizada ? 'blue-darken-2' :
    workflow ? workflowBadgeColor(workflow) : uiColor

  return { uiProgress, uiColor, uiHidePend, uiFiltro, uiBadge, uiBadgeColor }
}

const chipTextFromFiltro = (f: 'Pendiente'|'Cotizadas'|'Ganadas'|'Perdidas'|'Aplazadas'|'Reabiertas'|'SinRevisar') =>
  f === 'Ganadas' ? 'Ganada' :
  f === 'Perdidas' ? 'Perdida' :
  f === 'Aplazadas' ? 'Aplazada' :
  f === 'Reabiertas' ? 'Reabierta' :
  f === 'Cotizadas' ? 'Cotizada' : 'Pendiente'
const page    = ref(1)
const perPage = computed(() => vistaCompacta.value ? 12 : 9)

// Datos de la página actual (raw)
const pageDocs = ref<any[]>([])

const cursors = ref<(DocumentSnapshot | null)[]>([null]) // página 1 empieza sin cursor
const hasMore = ref<boolean>(false)
const totalFiltered = ref(0) // total exacto cuando la carga es en cliente
const pageCount = computed(() => {
  if (totalFiltered.value > 0) {
    return Math.max(1, Math.ceil(totalFiltered.value / perPage.value))
  }
  // Paginación server-side: solo sabemos la página actual y si hay más
  return hasMore.value ? page.value + 1 : Math.max(1, page.value)
})

const status  = ref<FiltroClave>('all')
const stockFilter = ref<'sin' | null>(null)
const tarifaFilter = ref('')
const fechaDesde = ref('')
const fechaHasta = ref('')

const VALID_STATUS = ['all', 'Pendiente', 'Reabiertas', 'SinRevisar', 'Cotizadas', 'Ganadas', 'Perdidas', 'Aplazadas'] as const

function applyQueryFromRoute() {
  const q = route.query
  const s = String(q.status || '')
  status.value = VALID_STATUS.includes(s as typeof VALID_STATUS[number]) ? s as FiltroClave : 'all'
  stockFilter.value = q.stock === 'sin' ? 'sin' : null
  selectedComercialUid.value = q.comercial ? String(q.comercial) : null
  search.value = q.search ? String(q.search) : ''
  fechaDesde.value = q.fechaDesde ? String(q.fechaDesde) : ''
  fechaHasta.value = q.fechaHasta ? String(q.fechaHasta) : ''
  tarifaFilter.value = q.tarifa ? String(q.tarifa) : ''
}

function matchesStock(c: any) {
  if (stockFilter.value !== 'sin') return true
  return stockNeedsCompras(normalizeStockEstado(c))
}

function stockLabel(c: any) {
  return stockEstadoLabel(normalizeStockEstado(c))
}

function stockColor(c: any) {
  return stockChipColor(normalizeStockEstado(c))
}

function pendienteStrip(c: any) {
  if (!user.canVerPendienteCompras) return null
  return pendienteStripState(c, { forCompras: user.isCompras })
}

function matchesTarifa(c: any) {
  if (!tarifaFilter.value) return true
  return String(c.tarifa || '') === tarifaFilter.value
}

function needsClientFetch() {
  // Si hay cualquier filtro de estado activo (no 'all'), usar fetch en cliente para evitar
  // necesitar índices compuestos en Firestore que podrían no existir.
  // La query server-side solo se usa para la vista 'all' sin otros filtros activos.
  if (status.value !== 'all') return true
  return !!search.value.trim()
    || !!(fechaDesde.value || fechaHasta.value)
    || stockFilter.value === 'sin'
    || !!tarifaFilter.value
    || (!isSupervisor.value && !!user.uid)
    || (isSupervisor.value && !!selectedComercialUid.value)
    || filtroPendienteComprasActivo.value
}
const norm = (s:any) =>
  String(s||'')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu,'') // quita tildes
    .trim()

function matchesCliente(c: any, term: string) {
  const q = norm(term)
  if (!q) return true
  return norm(c?.cliente).includes(q)
}

function getCotizacionMs(c: any): number {
  const ts = c.fechaCreacion || c.updatedAt || c.createdAt
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.toDate === 'function') return ts.toDate().getTime()
  const d = new Date(ts)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

function matchesDate(c: any) {
  const ms = getCotizacionMs(c)
  if (!fechaDesde.value && !fechaHasta.value) return true
  if (!ms) return false

  if (fechaDesde.value) {
    const start = new Date(`${fechaDesde.value}T00:00:00`).getTime()
    if (ms < start) return false
  }
  if (fechaHasta.value) {
    const end = new Date(`${fechaHasta.value}T23:59:59.999`).getTime()
    if (ms > end) return false
  }
  return true
}

function applyStatusFilter(base: any[]) {
  switch (status.value) {
    case 'all':         return base
    case 'Ganadas':     return base.filter(isGanada)
    case 'Perdidas':    return base.filter(isPerdida)
    case 'Aplazadas':   return base.filter(isAplazada)
    case 'Cotizadas':   return base.filter(isCotizada)
    case 'SinRevisar':  return base.filter(isSinRevisar)
    case 'Reabiertas':  return base.filter(isReabierta)
    case 'Pendiente':   return base.filter(c => isPendienteParaRol(c))
    default:            return base
  }
}

/**
 * "Pendientes" muestra solo cotizaciones que requieren acción del rol actual:
 * - Compras: stock sin/parcial sin responder + consultando proveedor/compras.
 * - Supervisora: sin revisar + en revisión, EXCLUYENDO consultando proveedor/compras
 *   y las que aún esperan respuesta de Compras (sin stock/parcial sin responder).
 * - Comercial: todas las pendientes abiertas.
 */
function isPendienteParaRol(c: any): boolean {
  const w = norm(c.workflow)
  const abierta = !isGanada(c) && !isPerdida(c) && !isAplazada(c) && !isCotizada(c)
  if (!abierta) return false

  if (user.isCompras) {
    if (w === 'consultando' || w === 'consultando_compras') return true
    return pendienteComprasActive(c)
  }

  if (user.isSupervisor) {
    // Aún espera respuesta de Compras → no le toca a la supervisora
    if (pendienteComprasActive(c)) return false
    // Consultando proveedor o compras → pendiente de Compras, no de supervisora
    if (w === 'consultando' || w === 'consultando_compras') return false
    if (w === 'espera_comercial') {
      return comercialHaRespondidoEspera(c)
    }
    return isSinRevisar(c) || isReabierta(c) || pendienteSupervisorActive(c)
  }

  // Comercial: todas las pendientes
  return isSinRevisar(c) || isReabierta(c)
}

const isGanada = (c:any) => {
  const e = norm(c.estado)
  return ['ganada','ganado','ganadas','ganados'].includes(e)
}
const isPerdida = (c:any) => {
  const e = norm(c.estado)
  return ['perdida','perdido','perdidas','perdidos'].includes(e)
}
const isAplazada = (c:any) => {
  const e = norm(c.estado)
  return ['aplazada','aplazado','aplazadas','aplazados'].includes(e)
}
const isCotizada = (c:any) =>
  norm(c.workflow) === 'cotizado' && !isGanada(c) && !isPerdida(c) && !isAplazada(c)
const isSinRevisar = (c:any) => {
  const e = norm(c.estado)
  const w = norm(c.workflow)
  return (!e || e === 'pendiente') && !w
}
const isReabierta = (c:any) => {
  const e = norm(c.estado)
  const w = norm(c.workflow)
  return e === 'reabierta' || ((e === 'pendiente' || !e) && ['en_revision','consultando','consultando_compras','espera_cliente','espera_comercial'].includes(w))
}

// Helpers locales para el filtro de pendientes (sin cargar comentarios del chat)
function pendienteComprasActive(c: any) {
  const abierta = !isGanada(c) && !isPerdida(c) && !isAplazada(c) && !isCotizada(c)
  if (!abierta) return false
  if (c.comprasRespondio === true) return false
  if (c.comprasAtendidoAt) return false
  return stockNeedsCompras(normalizeStockEstado(c))
}
function pendienteSupervisorActive(c: any) {
  const abierta = !isGanada(c) && !isPerdida(c) && !isAplazada(c) && !isCotizada(c)
  if (!abierta) return false
  const comprasOk = c.comprasRespondio === true || !!c.comprasAtendidoAt
  if (!comprasOk) return false
  return stockNeedsCompras(normalizeStockEstado(c))
}

// Lista filtrada SOLO sobre la página actual (pageDocs)
const itemsFiltrados = computed(() => {
  const base = (pageDocs.value || []).map(c => ({ ...c, ...deriveUI(c) }))
  return applyStatusFilter(base)
})


watch(status, v => console.debug('[chips] status ->', v), { immediate:true })

watch(pageDocs, (v) => {
  console.group('[pageDocs] dump')
  console.table((v||[]).map(c => ({
    id: c.id,
    estado: c.estado ?? '',
    workflow: c.workflow ?? '',
    estado_norm: norm(c.estado),
    workflow_norm: norm(c.workflow),
  })))
  console.groupEnd()
})


// Vista compacta / completa (persistida por usuario)
const VISTA_COMPACTA_KEY = 'cotizaciones.vistaCompacta'
const vistaCompacta = ref(false)
let skipVistaPaginationReset = true

function loadVistaCompactaPreference() {
  vistaCompacta.value = readUserBool(VISTA_COMPACTA_KEY, user.uid)
}

function toggleVista() { vistaCompacta.value = !vistaCompacta.value }

// Totales
const totalCotizado = (art: any[]) =>
  (art || []).reduce((a, r) => a + (Number(r.unidades) || 0) * (Number(r.precioCotizado) || 0), 0)
const totalCliente = (art: any[]) =>
  (art || []).reduce((a, r) => a + (Number(r.unidades) || 0) * (Number(r.precioCliente) || 0), 0)
const commentPreview = (text?: string | null) => {
  const raw = String(text || '').trim()
  if (!raw) return 'Sin comentarios'
  return looksLikeHtml(raw) ? htmlToPlainText(raw) : raw
}
const initials = (name: string) =>
  (name || '—').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')

// Construye la query con filtros de ámbito (el filtrado de estado se hace en cliente)
function scopeConstraints() {
  const constraints: any[] = []

  if (isSupervisor.value) {
    if (selectedComercialUid.value && !isPendienteComprasFilterUid(selectedComercialUid.value)) {
      constraints.push(where('vendedor.uid', '==', selectedComercialUid.value))
    }
  } else if (user.uid) {
    constraints.push(where('vendedor.uid', '==', user.uid))
  } else {
    constraints.push(where('vendedor.uid', '==', '__none__'))
  }

  return constraints
}

function buildQuery(forPage: number) {
  const base = collection($db, 'cotizaciones')
  const constraints: any[] = [...scopeConstraints()]

  const sv = String(status.value) as FiltroClave
  switch (sv) {
    case 'Ganadas':
      constraints.push(where('estado', '==', 'ganada'))
      break
    case 'Perdidas':
      constraints.push(where('estado', '==', 'perdida'))
      break
    case 'Cotizadas':
      constraints.push(where('workflow', '==', 'cotizado'))
      break
    case 'Reabiertas':
      constraints.push(where('estado', '==', 'reabierta'))
      break
  }

  constraints.push(orderBy('updatedAt', 'desc'))
  constraints.push(limit(perPage.value))

  const cursor = cursors.value[forPage - 1]
  if (forPage > 1 && cursor) {
    constraints.push(startAfter(cursor))
  }

  return query(base, ...constraints)
}

async function fetchScopedCotizaciones(max = 500) {
  const pendienteCompras = isPendienteComprasFilterUid(selectedComercialUid.value)
  const comercial = pendienteCompras
    ? null
    : comerciales.value.find(c => c.uid === selectedComercialUid.value)
  const scopeUids = comercial
    ? [comercial.uid, comercial.authUid, comercial.legacyUid].filter(Boolean) as string[]
    : (user.scopeUids?.length ? user.scopeUids : (user.uid ? [user.uid] : []))

  return fetchCotizacionesForScope($db as any, {
    isSupervisor: isSupervisor.value,
    scopeUids,
    userEmail: user.email,
    selectedComercialUid: pendienteCompras ? null : selectedComercialUid.value,
    selectedComercialEmail: comercial?.email || null,
    max,
  })
}

function applyPendienteComprasFilter(list: any[]) {
  if (!filtroPendienteComprasActivo.value) return list
  return list.filter(c => pendienteEnColaCompras(c))
}

// Carga una página concreta
async function loadPage(forPage: number) {
  loading.value = true
  pageDocs.value = []
  try {
    const qStr = search.value.trim()

    if (needsClientFetch()) {
      const all = await fetchScopedCotizaciones()
      let filtered = all
      if (qStr) filtered = filtered.filter(c => matchesCliente(c, qStr))
      if (fechaDesde.value || fechaHasta.value) filtered = filtered.filter(matchesDate)
      if (stockFilter.value === 'sin') filtered = filtered.filter(matchesStock)
      if (tarifaFilter.value) filtered = filtered.filter(matchesTarifa)
      filtered = applyPendienteComprasFilter(filtered)
      filtered = applyStatusFilter(filtered)
      totalFiltered.value = filtered.length
      const start = (forPage - 1) * perPage.value
      const slice = filtered.slice(start, start + perPage.value)

      pageDocs.value = slice
      store.items = slice
      hasMore.value = start + perPage.value < filtered.length
      cursors.value[forPage] = null
      return
    }

    totalFiltered.value = 0
    const q = buildQuery(forPage)
    const snap = await getDocs(q)
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))

    pageDocs.value = docs
    store.items = docs

    hasMore.value = docs.length === perPage.value
    cursors.value[forPage] = snap.docs[snap.docs.length - 1] || null

  } catch (e:any) {
    console.error('[cotizaciones] error al cargar la página', e)
  } finally {
    loading.value = false
  }
}


// --- Esperar a que el userStore termine antes de la primera carga ---
async function boot() {
  if (user.loading) {
    await new Promise<void>((resolve)=>{
      const stop = watch(()=>user.loading, (v)=>{
        if (!v){ stop(); resolve() }
      }, { immediate:true })
    })
  }
  if (isSupervisor.value) {
    await loadComerciales()
  }
  applyQueryFromRoute()
  loadVistaCompactaPreference()
  skipVistaPaginationReset = false
  page.value = 1
  cursors.value = [null]
  loadPage(1)
}

// Recarga silenciosa cada 5 minutos para mantener los datos frescos
const AUTO_REFRESH_MS = 5 * 60 * 1000
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null

// Inicial
onMounted(() => {
  boot()
  autoRefreshTimer = setInterval(() => {
    if (!loading.value) {
      page.value = 1
      cursors.value = [null]
      loadPage(1)
    }
  }, AUTO_REFRESH_MS)
})

onUnmounted(() => {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer)
})

watch(() => route.query, () => {
  applyQueryFromRoute()
  page.value = 1
  cursors.value = [null]
  loadPage(1)
}, { deep: true })

// Cambios de filtros → reiniciar a página 1
watch([status, selectedComercialUid, fechaDesde, fechaHasta, stockFilter, tarifaFilter], () => {
  page.value = 1
  cursors.value = [null]
  loadPage(1)
})

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    cursors.value = [null]
    loadPage(1)
  }, 300)
})

watch(vistaCompacta, (v) => {
  writeUserBool(VISTA_COMPACTA_KEY, user.uid, v)
  if (skipVistaPaginationReset) return
  page.value = 1
  cursors.value = [null]
  loadPage(1)
})

// Si cambia el rol o el uid → recargar
watch([() => user.uid, () => (user.rol || '').toLowerCase()], () => {
  skipVistaPaginationReset = true
  loadVistaCompactaPreference()
  skipVistaPaginationReset = false
  page.value = 1
  cursors.value = [null]
  loadPage(1)
})

// Cambios de página
watch(page, (p) => {
  loadPage(p)
})

function goNueva() {
  navigateTo('/cotizaciones/nueva')
}

function limpiarFechas() {
  fechaDesde.value = ''
  fechaHasta.value = ''
}

const canBorrarCotizacion = computed(() => user.canBorrarCotizacion)
const showDelete = ref(false)
const deleting = ref(false)
const deleteError = ref('')
const cotToDelete = ref<{ id: string; numero?: string; cliente?: string } | null>(null)

function abrirEliminar(c: { id: string; numero?: string; cliente?: string }) {
  deleteError.value = ''
  cotToDelete.value = c
  showDelete.value = true
}

async function confirmarEliminar() {
  if (!cotToDelete.value?.id) return
  deleteError.value = ''
  deleting.value = true
  try {
    const { authFetch } = useAuthFetch()
    await authFetch(`/api/cotizaciones/${cotToDelete.value.id}`, { method: 'DELETE' })
    showDelete.value = false
    cotToDelete.value = null
    await loadPage(page.value)
  } catch (e: any) {
    deleteError.value = e?.data?.statusMessage || e?.message || 'No se pudo borrar la cotización'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <v-container class="py-6">
    <!-- Header + filtros -->
    <h2 class="text-2xl font-bold">
      {{ isSupervisor ? 'Todas las Cotizaciones' : 'Mis Cotizaciones' }}
    </h2>
    <v-breadcrumbs
      :items="[
        { title: 'Cotizaciones', disabled: true },
        { title: isSupervisor ? 'Todas' : 'Mis Cotizaciones', disabled: true }
      ]"
      divider="/"
      class="text-gray-500"
    />

    <section class="toolbar mb-6">
      <!-- Fila 1: estados + acción principal -->
      <div class="toolbar__row toolbar__row--top">
        <v-chip-group v-model="status" mandatory class="seg" selected-class="seg__chip--active">
          <v-chip value="all" variant="text" class="seg__chip">
            <Icon name="mdi:format-list-bulleted" class="seg__icon" /> Todas
          </v-chip>
          <v-chip value="Pendiente" variant="text" class="seg__chip">
            <Icon name="mdi:progress-clock" class="seg__icon" /> Pendientes
          </v-chip>
          <v-chip value="SinRevisar" variant="text" class="seg__chip">
            <Icon name="mdi:eye-off" class="seg__icon" /> Sin revisar
          </v-chip>
          <v-chip value="Reabiertas" variant="text" class="seg__chip">
            <Icon name="mdi:refresh" class="seg__icon" /> Reabiertas
          </v-chip>
          <v-chip value="Cotizadas" variant="text" class="seg__chip">
            <Icon name="mdi:file-certificate" class="seg__icon" /> Cotizadas
          </v-chip>
          <v-chip value="Ganadas" variant="text" class="seg__chip">
            <Icon name="mdi:trophy" class="seg__icon" /> Ganadas
          </v-chip>
          <v-chip value="Perdidas" variant="text" class="seg__chip">
            <Icon name="mdi:thumb-down" class="seg__icon" /> Perdidas
          </v-chip>
          <v-chip value="Aplazadas" variant="text" class="seg__chip">
            <Icon name="mdi:clock-outline" class="seg__icon" /> Aplazadas
          </v-chip>
        </v-chip-group>

        <div class="toolbar__cta-group">
          <v-btn-toggle
            :model-value="vistaCompacta ? 'compact' : 'full'"
            mandatory
            variant="outlined"
            color="primary"
            density="compact"
            class="vista-toggle"
            @update:model-value="v => vistaCompacta = v === 'compact'"
          >
            <v-btn value="full" title="Vista completa">
              <Icon name="mdi:view-grid" />
            </v-btn>
            <v-btn value="compact" title="Vista compacta">
              <Icon name="mdi:view-list" />
            </v-btn>
          </v-btn-toggle>

          <v-btn
            v-if="!user.isCompras"
            color="primary"
            rounded="lg"
            class="toolbar__cta"
            @click="goNueva"
          >
            <Icon name="mdi:plus" class="me-1" /> Nueva cotización
          </v-btn>
        </div>
      </div>

      <v-divider class="toolbar__divider" />

      <!-- Fila 2: búsqueda, fechas y comercial -->
      <div class="toolbar__row toolbar__row--controls">
        <v-text-field
          v-model="search"
          variant="outlined"
          density="compact"
          placeholder="Buscar por cliente…"
          hide-details
          class="ctrl ctrl--search"
        >
          <template #prepend-inner><Icon name="mdi:magnify" /></template>
        </v-text-field>

        <!-- Rango de fechas agrupado -->
        <div class="daterange" :class="{ 'daterange--active': fechaDesde || fechaHasta }">
          <Icon name="mdi:calendar-range" class="daterange__icon" />
          <input
            v-model="fechaDesde"
            type="date"
            class="daterange__input"
            aria-label="Desde"
          />
          <span class="daterange__sep">→</span>
          <input
            v-model="fechaHasta"
            type="date"
            class="daterange__input"
            :min="fechaDesde || undefined"
            aria-label="Hasta"
          />
          <button
            v-if="fechaDesde || fechaHasta"
            type="button"
            class="daterange__clear"
            title="Limpiar fechas"
            @click="limpiarFechas"
          >
            <Icon name="mdi:close" />
          </button>
        </div>

        <!-- Select de comercial / pendiente compras (solo supervisora) -->
        <v-select
          v-if="isSupervisor"
          v-model="selectedComercialUid"
          :items="comercialesFilterItems"
          item-title="nombre"
          item-value="uid"
          placeholder="Filtrar por comercial"
          variant="outlined"
          density="compact"
          hide-details
          class="ctrl ctrl--comercial"
        >
          <template #prepend-inner>
            <Icon :name="filtroPendienteComprasActivo ? 'mdi:cart' : 'mdi:account-tie'" />
          </template>
        </v-select>
      </div>
    </section>

    <!-- Loading -->
    <v-skeleton-loader
      v-if="loading"
      type="image, article, article, article, actions"
      class="rounded-xl"
    />

    <!-- Grid -->
    <v-row v-else class="cotiz-grid" :class="{ 'cotiz-grid--compact': vistaCompacta }">
      <v-col
        v-for="c in itemsFiltrados"
        :key="c.id"
        cols="12"
        :sm="vistaCompacta ? 6 : 12"
        :md="vistaCompacta ? 4 : 4"
        :lg="vistaCompacta ? 3 : 4"
        class="cotiz-col"
        :class="{ 'cotiz-col--compact': vistaCompacta }"
      >
        <v-card
          class="card cotiz-card shadow-sm"
          :class="{
            'card--pendiente-compras': pendienteStrip(c)?.kind === 'compras',
            'card--pendiente-supervisor': pendienteStrip(c)?.kind === 'supervisor',
            'cotiz-card--compact': vistaCompacta,
          }"
        >
          <!-- CABECERA (siempre visible) -->
          <v-card-text :class="vistaCompacta ? 'cotiz-card__body cotiz-card__body--compact' : 'cotiz-card__body'">
            <div class="cotiz-card__head d-flex items-start justify-between">
              <div class="cotiz-card__title-wrap">
                <div class="cotiz-card__title-row">
                  <v-avatar size="32" class="elev cotiz-card__avatar">
                    <div class="avatar-initials">{{ initials(c.cliente) }}</div>
                  </v-avatar>
                  <h4 class="cotiz-card__title">{{ c.cliente }}</h4>
                </div>
                <div class="cotiz-card__meta-line">
                  #{{ c.numero }} · {{ tarifaLabel(c.tarifa) }} ·
                  {{ new Date((c.updatedAt?.toMillis?.() || c.createdAt?.toMillis?.() || 0)).toLocaleDateString('es-ES') }}
                </div>
              </div>
              <v-chip
                v-if="!c.uiHidePend"
                :color="c.uiBadgeColor"
                size="small"
                label
                class="cotiz-card__status"
              >
                {{ c.uiBadge }}
              </v-chip>
            </div>

            <!-- DETALLES: solo en vista completa -->
            <template v-if="!vistaCompacta">
              <div class="cotiz-card__comment">
                <span class="cotiz-card__comment-label">Comentarios</span>
                <p class="cotiz-card__comment-text">{{ commentPreview(c.comentariosCliente) }}</p>
              </div>

              <div class="cotiz-card__metrics">
                <div class="cotiz-card__metric">
                  <span class="cotiz-card__metric-label">Ref. Artículos</span>
                  <span class="cotiz-card__metric-value">{{ (c.articulos || []).length }}</span>
                </div>
                <div class="cotiz-card__metric">
                  <span class="cotiz-card__metric-label">Total cliente</span>
                  <span class="cotiz-card__metric-value">€ {{ totalCliente(c.articulos).toFixed(2) }}</span>
                </div>
                <div class="cotiz-card__metric">
                  <span class="cotiz-card__metric-label">Total cotizado</span>
                  <span class="cotiz-card__metric-value">€ {{ totalCotizado(c.articulos).toFixed(2) }}</span>
                </div>
              </div>

              <div class="cotiz-card__tags">
                {{ c.licitacion ? 'Licitación' : 'Venta directa' }} · {{ stockLabel(c) }}
              </div>

              <div class="cotiz-card__pendiente-slot">
                <div
                  v-if="pendienteStrip(c)"
                  class="pendiente-compras"
                  :class="pendienteStrip(c)!.kind === 'supervisor' ? 'pendiente-compras--supervisor' : 'pendiente-compras--compras'"
                >
                  <span class="pendiente-compras__icon-wrap">
                    <Icon :name="pendienteStrip(c)!.kind === 'supervisor' ? 'mdi:account-supervisor-outline' : 'mdi:clipboard-text-clock-outline'" />
                  </span>
                  <div class="pendiente-compras__copy">
                    <div class="pendiente-compras__row">
                      <strong>{{ pendienteStrip(c)!.meta.title }}</strong>
                      <span class="pendiente-compras__tag">{{ pendienteStrip(c)!.meta.stockTag }}</span>
                    </div>
                    <span class="pendiente-compras__hint">{{ pendienteStrip(c)!.meta.hint }}</span>
                  </div>
                </div>
              </div>

              <div class="cotiz-card__progress">
                <div class="cotiz-card__progress-head">
                  <span>Progreso</span>
                  <span class="cotiz-card__progress-meta">
                    {{ c.uiProgress }}% · {{ chipTextFromFiltro(c.uiFiltro) }}
                    <span v-if="c.workflow">· {{ workflowLabelShort(c.workflow) }}</span>
                  </span>
                </div>
                <v-progress-linear
                  :model-value="c.uiProgress"
                  :color="c.uiColor"
                  height="6"
                  rounded
                />
              </div>
            </template>

            <!-- En vista compacta: solo barra de progreso pequeña -->
            <v-progress-linear
              v-if="vistaCompacta"
              :model-value="c.uiProgress"
              :color="c.uiColor"
              height="3"
              rounded
              class="mt-2"
            />
          </v-card-text>

          <v-divider />

          <v-card-actions class="cotiz-card__actions" :class="{ 'cotiz-card__actions--compact': vistaCompacta }">
            <v-btn
              v-if="canBorrarCotizacion && !vistaCompacta"
              variant="text"
              color="error"
              @click.stop="abrirEliminar(c)"
            >
              <template #prepend><Icon name="mdi:delete-outline" /></template>
              Eliminar
            </v-btn>
            <v-spacer />
            <NuxtLink :to="`/cotizaciones/${c.id}`">
              <v-btn variant="text" color="primary">Ver detalle</v-btn>
            </NuxtLink>
          </v-card-actions>
        </v-card>
      </v-col>

      <v-col cols="12" v-if="!itemsFiltrados.length && !loading">
        <v-alert type="info" variant="tonal">
          No hay cotizaciones con esos filtros.
        </v-alert>
      </v-col>
    </v-row>
    <!-- Paginación -->
    <div v-if="pageCount > 1 || page > 1" class="pagination-bar mt-6">
      <v-btn
        icon
        variant="tonal"
        size="small"
        :disabled="page <= 1 || loading"
        @click="page = 1"
        title="Primera página"
      >
        <Icon name="mdi:chevron-double-left" />
      </v-btn>

      <v-btn
        variant="tonal"
        size="small"
        :disabled="page <= 1 || loading"
        @click="page = Math.max(1, page - 1)"
      >
        <Icon name="mdi:chevron-left" class="mr-1" /> Anterior
      </v-btn>

      <span class="pagination-bar__label">
        Página <strong>{{ page }}</strong>
        <template v-if="pageCount > 1"> de <strong>{{ pageCount }}</strong></template>
      </span>

      <v-btn
        variant="tonal"
        size="small"
        :disabled="!hasMore || loading"
        @click="page = page + 1"
      >
        Siguiente <Icon name="mdi:chevron-right" class="ml-1" />
      </v-btn>

      <v-btn
        v-if="pageCount > 2"
        icon
        variant="tonal"
        size="small"
        :disabled="!hasMore || loading"
        @click="page = pageCount"
        title="Última página conocida"
      >
        <Icon name="mdi:chevron-double-right" />
      </v-btn>
    </div>

    <!-- Dialog ELIMINAR -->
    <v-dialog v-model="showDelete" max-width="480" persistent>
      <v-card>
        <v-card-title class="text-h6">Eliminar cotización</v-card-title>
        <v-card-text>
          <p>
            ¿Deseas eliminar la cotización
            <strong>#{{ cotToDelete?.numero || '—' }}</strong>
            de <strong>{{ cotToDelete?.cliente || '—' }}</strong>?
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

  </v-container>
</template>

<style scoped>
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 0 16px;
}
.pagination-bar__label {
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
  min-width: 100px;
  text-align: center;
}

.cotiz-grid {
  align-items: stretch;
}
.cotiz-col {
  display: flex;
}
.cotiz-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}
.cotiz-card__body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 16px !important;
}
/* ── Vista compacta ─────────────────────────── */
.cotiz-grid--compact {
  align-items: start;
}
.cotiz-col--compact {
  align-items: stretch;
}
.cotiz-card--compact {
  height: auto;
}
.cotiz-card__body--compact {
  gap: 6px;
  padding: 12px 14px 10px !important;
}
.cotiz-card__actions--compact {
  min-height: 40px;
  padding: 4px 10px !important;
}
.toolbar__cta-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vista-toggle {
  flex-shrink: 0;
}
.cotiz-card__head {
  gap: 12px;
}
.cotiz-card__title-wrap {
  min-width: 0;
  flex: 1;
}
.cotiz-card__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.cotiz-card__avatar {
  flex-shrink: 0;
}
.cotiz-card__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.25;
  color: #0f172a;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-transform: uppercase;
  letter-spacing: 0.01em;
}
.cotiz-card__meta-line {
  font-size: 0.82rem;
  color: #64748b;
  line-height: 1.35;
}
.cotiz-card__status {
  flex-shrink: 0;
  align-self: flex-start;
}
.cotiz-card__comment {
  min-height: 4.75rem;
  padding: 10px 12px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #eef2f7;
}
.cotiz-card__comment-label {
  display: block;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  margin-bottom: 4px;
}
.cotiz-card__comment-text {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.45;
  color: #475569;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cotiz-card__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e8edf4;
}
.cotiz-card__metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cotiz-card__metric-label {
  font-size: 0.72rem;
  color: #64748b;
  line-height: 1.2;
}
.cotiz-card__metric-value {
  font-size: 0.92rem;
  font-weight: 700;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cotiz-card__tags {
  font-size: 0.82rem;
  color: #64748b;
}
.cotiz-card__pendiente-slot {
  min-height: 72px;
  display: flex;
  align-items: stretch;
}
.cotiz-card__pendiente-slot .pendiente-compras {
  margin-top: 0;
  width: 100%;
}
.cotiz-card__progress {
  margin-top: auto;
  padding-top: 4px;
}
.cotiz-card__progress-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
  font-size: 0.82rem;
  color: #64748b;
}
.cotiz-card__progress-meta {
  text-align: right;
  font-weight: 600;
  color: #334155;
  line-height: 1.35;
}
.cotiz-card__actions {
  margin-top: auto;
  min-height: 52px;
}
.card{ border-radius: 16px; }
.card--pendiente-compras{
  border-left: 3px solid #6366f1;
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.08);
}
.card--pendiente-supervisor{
  border-left: 3px solid #0ea5e9;
  box-shadow: 0 4px 20px rgba(14, 165, 233, 0.08);
}
.pendiente-compras{
  display:flex;
  align-items:flex-start;
  gap:12px;
  margin-top:12px;
  padding:12px 14px;
  border-radius:14px;
}
.pendiente-compras--compras{
  background: linear-gradient(135deg, #f5f3ff 0%, #eef2ff 100%);
  border: 1px solid rgba(99, 102, 241, 0.18);
}
.pendiente-compras--supervisor{
  background: linear-gradient(135deg, #f0f9ff 0%, #ecfeff 100%);
  border: 1px solid rgba(14, 165, 233, 0.18);
}
.pendiente-compras--compras .pendiente-compras__icon-wrap{
  color:#6366f1;
  box-shadow:0 1px 3px rgba(99, 102, 241, 0.12);
}
.pendiente-compras--supervisor .pendiente-compras__icon-wrap{
  color:#0ea5e9;
  box-shadow:0 1px 3px rgba(14, 165, 233, 0.12);
}
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
  width:36px;
  height:36px;
  border-radius:10px;
  display:grid;
  place-items:center;
  flex-shrink:0;
  background:rgba(255,255,255,0.85);
  color:#6366f1;
  font-size:1.15rem;
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
  font-size:.86rem;
  font-weight:700;
  letter-spacing:-0.01em;
}
.pendiente-compras__tag{
  display:inline-flex;
  align-items:center;
  padding:2px 8px;
  border-radius:999px;
  font-size:.72rem;
  font-weight:600;
  background:rgba(255,255,255,0.75);
  border:1px solid transparent;
}
.pendiente-compras__hint{
  display:block;
  margin-top:4px;
  font-size:.78rem;
  line-height:1.4;
  color:#64748b;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.text-gray-500{ color:#6b7280 }
.text-gray-600{ color:#4b5563 }
.shadow-sm{ box-shadow: 0 8px 24px rgba(2, 6, 23, 0.06) }
.avatar-initials{
  width:100%;height:100%;display:flex;align-items:center;justify-content:center;
  font-weight:700;color:#0f172a;background:#e5efff;border-radius:9999px;
}
.elev{ box-shadow: 0 2px 8px rgba(2, 6, 23, .12) }

/* ===== Toolbar de filtros ===== */
.toolbar {
  background: #ffffff;
  border: 1px solid #e6e9ef;
  border-radius: 18px;
  box-shadow: 0 6px 20px rgba(2, 6, 23, 0.05);
  padding: 12px 14px;
}
.toolbar__row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.toolbar__row--top {
  justify-content: space-between;
  flex-wrap: wrap;
}
.toolbar__divider {
  margin: 12px 0;
  opacity: .6;
}
.toolbar__row--controls {
  flex-wrap: wrap;
}
.toolbar__cta {
  flex-shrink: 0;
  text-transform: none;
  font-weight: 600;
  letter-spacing: .2px;
  height: 40px;
}

/* Segmented control de estados */
.seg {
  gap: 6px;
  flex-wrap: wrap;
}
.seg :deep(.v-slide-group__content) {
  gap: 6px;
  flex-wrap: wrap;
}
.seg__chip {
  height: 36px;
  border-radius: 10px;
  padding: 0 14px;
  color: #64748b;
  font-weight: 600;
  letter-spacing: .1px;
  transition: background-color .15s ease, color .15s ease;
}
.seg__chip:hover {
  background: #f1f5f9;
  color: #0f172a;
}
.seg__chip--active {
  background: #1976d2 !important;
  color: #ffffff !important;
  box-shadow: 0 3px 10px rgba(25, 118, 210, .28);
}
.seg__icon {
  margin-right: 6px;
  font-size: 17px;
}

/* Controles homogéneos */
.ctrl :deep(.v-field) {
  border-radius: 12px;
  background: #f8fafc;
}
.ctrl--search { flex: 1 1 260px; min-width: 220px; max-width: 380px; }
.ctrl--comercial { flex: 0 1 240px; min-width: 200px; }

/* Rango de fechas como una sola unidad */
.daterange {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  background: #f8fafc;
  color: #475569;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.daterange--active {
  border-color: #1976d2;
  box-shadow: 0 0 0 3px rgba(25, 118, 210, .12);
}
.daterange__icon { font-size: 18px; color: #64748b; }
.daterange__input {
  border: none;
  background: transparent;
  outline: none;
  font: inherit;
  font-size: 13px;
  color: #0f172a;
  width: 118px;
  color-scheme: light;
}
.daterange__sep { color: #94a3b8; font-size: 13px; }
.daterange__clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px; height: 22px;
  border-radius: 6px;
  color: #64748b;
  transition: background-color .15s ease, color .15s ease;
}
.daterange__clear:hover { background: #e2e8f0; color: #0f172a; }

@media (max-width: 720px) {
  .toolbar__row--controls .ctrl--search,
  .toolbar__row--controls .ctrl--comercial,
  .daterange { flex: 1 1 100%; width: 100%; }
  .daterange { justify-content: space-between; }
  .daterange__input { width: auto; flex: 1; }
}
</style>

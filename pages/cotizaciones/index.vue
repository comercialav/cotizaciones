<script setup lang="ts">
definePageMeta({
  middleware: ['role-comercial']
})

import { useUserStore } from '~/stores/user'
import { useCotizacionesStore } from '~/stores/cotizaciones'
import {
  collection, query, where, orderBy, limit, getDocs, startAfter, DocumentSnapshot
} from 'firebase/firestore'

const { $db } = useNuxtApp()
const user = useUserStore()
const store = useCotizacionesStore()

// --- Roles / supervisor ---
const isSupervisor = computed(()=> user.isSupervisor || user.isCompras)

// --- Comerciales (para el select de la supervisora) ---
const comerciales = ref<{ uid:string; nombre:string; email?:string }[]>([])
const selectedComercialUid = ref<string | null>(null)

async function loadComerciales(){
  try{
    const qs = await getDocs(
      query(collection($db,'usuarios'), where('rol','==','comercial'))
    )

    comerciales.value = qs.docs
      .map(d=>{
        const data = d.data() as any
        return {
          uid: data.uid || null,
          nombre: data.nombre || data.displayName || 'Comercial',
          email: data.email || null
        }
      })
      .filter(c => !!c.uid)

  }catch(e){
    console.error('[comerciales] error', e)
    comerciales.value = []
  }
}

// UI
const loading = ref(true)
const search  = ref('')

type FiltroClave = 'all' | 'Pendiente' | 'Reabiertas' | 'SinRevisar' | 'Cotizadas' | 'Ganadas' | 'Perdidas'

function deriveUI(c: any) {
  const estado = String(c.estado || '').toLowerCase()
  const workflow = String(c.workflow || '').toLowerCase()

  const isGanada   = estado === 'ganada'
  const isPerdida  = estado === 'perdida'
  const isReab     = estado === 'reabierta'
  const isCotizada = workflow === 'cotizado'

  let uiProgress = 0
  if (isGanada || isPerdida) uiProgress = 100
  else if (workflow === 'cotizado') uiProgress = 80
  else if (workflow === 'espera_cliente') uiProgress = 60
  else if (workflow === 'consultando') uiProgress = 40
  else if (workflow === 'en_revision') uiProgress = 20

  const uiColor =
    isGanada  ? 'green-darken-2' :
    isPerdida ? 'red-darken-2'   :
    workflow === 'cotizado' ? 'blue-darken-2' :
    workflow === 'espera_cliente' ? 'lime-darken-2' :
    workflow === 'consultando' ? 'yellow-darken-2' :
    workflow === 'en_revision' ? 'amber-darken-2' : 'amber-darken-2'

  const uiHidePend = uiProgress === 100

  const uiFiltro: Exclude<FiltroClave,'all'|'Pendiente'> =
    isGanada   ? 'Ganadas'    :
    isPerdida  ? 'Perdidas'   :
    isCotizada ? 'Cotizadas'  :
    isReab     ? 'Reabiertas' :
                 'SinRevisar'

  return { uiProgress, uiColor, uiHidePend, uiFiltro }
}

const chipTextFromFiltro = (f: 'Pendiente'|'Cotizadas'|'Ganadas'|'Perdidas'|'Reabiertas'|'SinRevisar') =>
  f === 'Ganadas' ? 'Ganada' :
  f === 'Perdidas' ? 'Perdida' :
  f === 'Reabiertas' ? 'Reabierta' :
  f === 'Cotizadas' ? 'Cotizada' : 'Pendiente'
const page    = ref(1)
const perPage = 9

// Datos de la página actual (raw)
const pageDocs = ref<any[]>([])

const cursors = ref<(DocumentSnapshot | null)[]>([null]) // página 1 empieza sin cursor
const hasMore = ref<boolean>(false)
const pageCount = computed(() => {
  const known = Math.max(1, cursors.value.length - 1)
  return hasMore.value ? known + 1 : known
})

const status  = ref<FiltroClave>('all')
const fechaDesde = ref('')
const fechaHasta = ref('')
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
    case 'Cotizadas':   return base.filter(isCotizada)
    case 'SinRevisar':  return base.filter(isSinRevisar)
    case 'Reabiertas':  return base.filter(isReabierta)
    case 'Pendiente':   return base.filter(c => isReabierta(c) || isSinRevisar(c))
    default:            return base
  }
}

const isGanada = (c:any) => {
  const e = norm(c.estado)
  return ['ganada','ganado','ganadas','ganados'].includes(e)
}
const isPerdida = (c:any) => {
  const e = norm(c.estado)
  return ['perdida','perdido','perdidas','perdidos'].includes(e)
}
const isCotizada = (c:any) => norm(c.workflow) === 'cotizado'
const isSinRevisar = (c:any) => {
  const e = norm(c.estado)
  const w = norm(c.workflow)
  return (!e || e === 'pendiente') && !w
}
const isReabierta = (c:any) => {
  const e = norm(c.estado)
  const w = norm(c.workflow)
  return e === 'reabierta' || ((e === 'pendiente' || !e) && ['en_revision','consultando','espera_cliente'].includes(w))
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


// Totales
const totalCotizado = (art: any[]) =>
  (art || []).reduce((a, r) => a + (Number(r.unidades) || 0) * (Number(r.precioCotizado) || 0), 0)
const totalCliente = (art: any[]) =>
  (art || []).reduce((a, r) => a + (Number(r.unidades) || 0) * (Number(r.precioCliente) || 0), 0)
const initials = (name: string) =>
  (name || '—').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')

// Construye la query con filtros de ámbito (el filtrado de estado se hace en cliente)
function scopeConstraints() {
  const constraints: any[] = []

  if (isSupervisor.value) {
    if (selectedComercialUid.value) {
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
  constraints.push(limit(perPage))

  const cursor = cursors.value[forPage - 1]
  if (forPage > 1 && cursor) {
    constraints.push(startAfter(cursor))
  }

  return query(base, ...constraints)
}

async function fetchScopedCotizaciones(max = 500) {
  const constraints = [
    ...scopeConstraints(),
    orderBy('updatedAt', 'desc'),
    limit(max),
  ]
  const snap = await getDocs(query(collection($db, 'cotizaciones'), ...constraints))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Carga una página concreta
async function loadPage(forPage: number) {
  loading.value = true
  try {
    const qStr = search.value.trim()
    const hasDateFilter = !!(fechaDesde.value || fechaHasta.value)

    if (qStr || hasDateFilter) {
      const all = await fetchScopedCotizaciones()
      let filtered = all
      if (qStr) filtered = filtered.filter(c => matchesCliente(c, qStr))
      if (hasDateFilter) filtered = filtered.filter(matchesDate)
      filtered = applyStatusFilter(filtered)
      const start = (forPage - 1) * perPage
      const slice = filtered.slice(start, start + perPage)

      pageDocs.value = slice
      store.items = slice
      hasMore.value = start + perPage < filtered.length
      cursors.value[forPage] = null
      return
    }

    const q = buildQuery(forPage)
    const snap = await getDocs(q)
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))

    pageDocs.value = docs
    store.items = docs

    hasMore.value = docs.length === perPage
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
  page.value = 1
  cursors.value = [null]
  loadPage(1)
}

// Inicial
onMounted(() => {
  boot()
})

// Cambios de filtros → reiniciar a página 1
watch([status, selectedComercialUid, fechaDesde, fechaHasta], () => {
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

// Si cambia el rol o el uid → recargar
watch([() => user.uid, () => (user.rol || '').toLowerCase()], () => {
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
        </v-chip-group>

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

        <!-- Select de comercial (solo supervisora) -->
        <v-select
          v-if="isSupervisor"
          v-model="selectedComercialUid"
          :items="[{uid:null, nombre:'Todos'} as any, ...comerciales]"
          item-title="nombre"
          item-value="uid"
          placeholder="Comercial"
          variant="outlined"
          density="compact"
          hide-details
          class="ctrl ctrl--comercial"
        >
          <template #prepend-inner>
            <Icon name="mdi:account-tie" />
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
    <v-row v-else>
      <v-col cols="12" md="4" v-for="c in itemsFiltrados" :key="c.id">
        <v-card class="card shadow-sm">
          <v-card-text>
            <div class="d-flex items-start justify-between">
              <div>
                <div class="text-lg font-semibold mb-3 d-flex items-center gap-2 align-center">
                  <v-avatar size="32" class="elev">
                    <div class="avatar-initials">{{ initials(c.cliente) }}</div>
                  </v-avatar>
                  &nbsp;<h4 class="text-2xl font-bold text-uppercase ml-3">{{ c.cliente }}</h4>
                </div>
                <div class="text-gray-500 text-sm">
                  #{{ c.numero }} · Tarifa {{ c.tarifa || '—' }} ·
                  Fecha {{ new Date((c.updatedAt?.toMillis?.() || c.createdAt?.toMillis?.() || 0)).toLocaleDateString() }}
                </div>
              </div>
              <div class="text-gray-500 text-sm w-50 d-flex justify-end">
                <!-- ocultar chip Pendiente si 100% -->
                <v-chip
                  v-if="!c.uiHidePend"
                  :color="c.uiColor"
                  size="small"
                  label
                >
                  {{ chipTextFromFiltro(c.uiFiltro) }}
                </v-chip>
              </div>
            </div>

            <div class="text-gray-600 my-3">
              Comentarios: {{ c.comentariosCliente || 'Sin comentarios' }}
            </div>

            <div class="d-flex gap-8 text-sm mb-3">
              <div class="px-5">
                <div class="text-gray-500">Ref. Artículos</div>
                <div class="font-semibold">{{ (c.articulos || []).length }}</div>
              </div>
              <div class="px-5">
                <div class="text-gray-500">Total cliente</div>
                <div class="font-semibold">€ {{ totalCliente(c.articulos).toFixed(2) }}</div>
              </div>
              <div class="px-5">
                <div class="text-gray-500">Total cotizado</div>
                <div class="font-semibold">€ {{ totalCotizado(c.articulos).toFixed(2) }}</div>
              </div>
            </div>

            <div class="text-gray-500 text-sm">
              {{ c.licitacion ? 'Licitación' : 'Venta directa' }} ·
              {{ c.stockDisponible === false ? 'Sin stock' : 'Con stock' }}
            </div>

            <div class="d-flex items-center justify-between text-sm mb-1 mt-2">
              <div class="text-gray-500 mr-1">Progreso</div>
              <div class="font-medium">
                {{ c.uiProgress }}%
                ·
                {{ chipTextFromFiltro(c.uiFiltro) }}
                <span v-if="c.workflow">· {{ c.workflow.replace('_',' ') }}</span>
              </div>
            </div>
            <v-progress-linear
              :model-value="c.uiProgress"
              :color="c.uiColor"
              height="6"
              rounded
            />
          </v-card-text>

          <v-divider />

          <v-card-actions>
            <v-btn
              v-if="canBorrarCotizacion"
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
    <!-- Navegación Anterior / Siguiente -->
    <div class="d-flex justify-between mt-6">
      <v-btn
        variant="text"
        color="primary"
        prepend-icon="mdi-chevron-left"
        :disabled="page <= 1"
        @click="page = Math.max(1, page - 1)"
      >
        Anterior
      </v-btn>

      <v-btn
        variant="text"
        color="primary"
        append-icon="mdi-chevron-right"
        :disabled="!hasMore"
        @click="page = page + 1"
      >
        Siguiente
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
.card{ border-radius: 16px; }
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

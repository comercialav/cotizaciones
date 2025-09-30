<script setup lang="ts">
definePageMeta({
  middleware: ['role-comercial']
})

import { useUserStore } from '~/stores/user'
import { useCotizacionesStore } from '~/stores/cotizaciones'
import {
  collection, query, where, orderBy, limit, getDocs, startAfter, DocumentSnapshot
} from 'firebase/firestore'
import { liteClient as createClient } from 'algoliasearch/lite'
import type { LiteClient } from 'algoliasearch/lite'

const { public: cfg } = useRuntimeConfig()

let algolia: LiteClient
let algoliaIndex: { search: (q: string, p?: Record<string, any>) => Promise<any> }

if (process.client) {
  algolia = createClient(cfg.algoliaAppId, cfg.algoliaSearchKey)

  algoliaIndex = {
    async search(q, p = {}) {
      const { results } = await algolia.searchForHits({
        requests: [
          {
            indexName: cfg.algoliaIndex,   // string
            query: q,                      // string
            ...p                           // page, hitsPerPage, facetFilters, etc.
          }
        ]
      })
      return results[0]
    }
  }

}

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
const norm = (s:any) =>
  String(s||'')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu,'') // quita tildes
    .trim()

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
  if (search.value.trim()) return base

  // DEBUG resumen por categoría
  const dbg = { gan:0, per:0, cot:0, sin:0, reab:0, tot: base.length }
  for (const c of base) {
    if (isGanada(c)) dbg.gan++
    if (isPerdida(c)) dbg.per++
    if (isCotizada(c)) dbg.cot++
    if (isSinRevisar(c)) dbg.sin++
    if (isReabierta(c)) dbg.reab++
  }
  console.debug('[filtro] status=', status.value, 'resumen=', dbg)

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

// Construye la query con filtros de ámbito y búsqueda (el filtrado de estado se hace en cliente)
function buildQuery(forPage: number) {
  const base = collection($db, 'cotizaciones')
  const constraints: any[] = []

  // --- Ámbito por rol ---
  if (isSupervisor.value) {
    if (selectedComercialUid.value) {
      constraints.push(where('vendedor.uid','==', selectedComercialUid.value))
    }
  } else {
    if (!user.uid) {
      constraints.push(where('vendedor.uid','==','__none__'))
    } else {
      constraints.push(where('vendedor.uid','==', user.uid))
    }
  }

  // --- Búsqueda exacta por cliente ---
  if (search.value.trim()) {
    constraints.push(where('cliente','==', search.value.trim()))
  }

  // --- Orden + límite ---
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
      // Opción 1 simple: solo las marcadas como reabierta
      constraints.push(where('estado', '==', 'reabierta'))
      break
  }

  constraints.push(orderBy('updatedAt','desc'))
  constraints.push(limit(perPage))

  // --- Cursor ---
  const cursor = cursors.value[forPage - 1]
  if (forPage > 1 && cursor) {
    constraints.push(startAfter(cursor))
  }

  console.debug('[cotizaciones] query página', forPage, constraints)
  return query(base, ...constraints)
}

// Carga una página concreta
async function loadPage(forPage: number) {
  loading.value = true
  try {
    const qStr = search.value.trim()

    // --- MODO ALGOLIA: cuando hay texto a buscar ---
    if (qStr.length > 0) {
      const pageZero = Math.max(0, forPage - 1)

      // facetFilters: construimos según rol/estado
      const facetFilters: (string | string[])[] = []

      // ámbito por rol (igual que hacías en Firestore)
      if (isSupervisor.value) {
        if (selectedComercialUid.value) {
          facetFilters.push(`vendedor.uid:${selectedComercialUid.value}`)
        }
      } else {
        facetFilters.push(`vendedor.uid:${user.uid || '__none__'}`)
      }

      // estado/workflow según chips
      switch (status.value) {
        case 'Ganadas':   facetFilters.push(`estado:ganada`); break
        case 'Perdidas':  facetFilters.push(`estado:perdida`); break
        case 'Cotizadas': facetFilters.push(`workflow:cotizado`); break
        case 'Reabiertas':facetFilters.push(`estado:reabierta`); break
        // 'SinRevisar' / 'Pendiente' las puedes dejar en cliente o mapear si las indexas como flags
      }

      // Búsqueda “contiene” sobre los atributos configurados en Algolia
     const res = await algoliaIndex.search(qStr, {
        page: pageZero,
        hitsPerPage: perPage,
        facetFilters: facetFilters.length ? facetFilters : undefined
      })


      const docs = res.hits.map((h: any) => ({ id: h.id || h.objectID, ...h }))
      pageDocs.value = docs
      store.items = docs
      hasMore.value = (res.page + 1) < res.nbPages
      cursors.value[forPage] = null
      return
    }

    // --- MODO FIRESTORE: sin búsqueda (como ya lo tenías) ---
    const q = buildQuery(forPage)
    const snap = await getDocs(q)
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    console.table(docs.map(d => ({ id: d.id, estado: d.estado ?? '', workflow: d.workflow ?? '' })))

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

// Cambios de filtros/búsqueda/selección → reiniciar a página 1
watch([status, () => search.value.trim(), selectedComercialUid], () => {
  page.value = 1
  cursors.value = [null]
  loadPage(1)
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

    <v-sheet class="action-bar mb-6" color="#f5f6f8" rounded="xl" elevation="1">
      <div class="d-flex flex-wrap justify-space-between align-center ga-4">
        <!-- Filtros izquierda -->
        <div class="d-flex items-center gap-4">
          <v-chip-group v-model="status" mandatory class="filter-tabs ms-3">
            <v-chip value="all" variant="text" class="filter-chip" :class="{ 'filter-chip--active': status==='all' }">
              <Icon name="mdi:format-list-bulleted" class="me-2" /> Todas
            </v-chip>
            <v-chip value="Pendiente" variant="text" class="filter-chip" :class="{ 'filter-chip--active': status==='Pendiente' }">
              <Icon name="mdi:progress-clock" class="me-2" /> Pendientes
            </v-chip>
            <v-chip value="SinRevisar" variant="text" class="filter-chip" :class="{ 'filter-chip--active': status==='SinRevisar' }">
              <Icon name="mdi:eye-off" class="me-2" /> Sin Revisar
            </v-chip>
            <v-chip value="Reabiertas" variant="text" class="filter-chip" :class="{ 'filter-chip--active': status==='Reabiertas' }">
              <Icon name="mdi:refresh" class="me-2" /> Reabiertas
            </v-chip>
            <v-chip value="Cotizadas" variant="text" class="filter-chip" :class="{ 'filter-chip--active': status==='Cotizadas' }">
              <Icon name="mdi:file-certificate" class="me-2" /> Cotizadas
            </v-chip>
            <v-chip value="Ganadas" variant="text" class="filter-chip" :class="{ 'filter-chip--active': status==='Ganadas' }">
              <Icon name="mdi:trophy" class="me-2" /> Ganadas
            </v-chip>
            <v-chip value="Perdidas" variant="text" class="filter-chip" :class="{ 'filter-chip--active': status==='Perdidas' }">
              <Icon name="mdi:thumb-down" class="me-2" /> Perdidas
            </v-chip>
          </v-chip-group>

          <!-- Select de comercial (solo supervisora) -->
          <v-select
            v-if="isSupervisor"
            v-model="selectedComercialUid"
            :items="[{uid:null, nombre:'Todos'} as any, ...comerciales]"
            item-title="nombre"
            item-value="uid"
            label="Filtrar por comercial"
            variant="outlined"
            density="comfortable"
            hide-details
            class="ms-3"
            style="min-width: 260px;"
          >
            <template #prepend-inner>
              <Icon name="mdi:account-tie" />
            </template>
          </v-select>
        </div>

        <!-- Buscador + acción -->
        <div class="d-flex align-center justify-end ga-3 w-33">
          <v-text-field
            v-model="search"
            variant="outlined"
            density="compact"
            placeholder="Buscar por cliente (contiene)…"
            hide-details
            style="max-width: 300px"
          >
            <template #prepend-inner><Icon name="mdi:magnify" /></template>
          </v-text-field>

          <v-btn v-if="!user.isCompras" color="primary" rounded="lg" size="large" @click="goNueva">
            Nueva cotización
          </v-btn>
        </div>
      </div>
    </v-sheet>

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

          <v-card-actions class="justify-end">
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
.action-bar { padding: 14px 18px; border: 1px solid #eceff3; }
.filter-tabs { gap: 10px; }
.filter-chip {
  --chip-padding: 10px 12px;
  padding: var(--chip-padding);
  height: 38px; border-radius: 12px;
  color: #6b7280; font-weight: 600; letter-spacing: .2px;
}
.filter-chip--active { color: var(--v-primary-base, #1976d2); background: transparent; }
</style>

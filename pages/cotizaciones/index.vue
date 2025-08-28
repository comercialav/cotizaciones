<script setup lang="ts">
definePageMeta({
  middleware: ['role-comercial']
})

import { useUserStore } from '~/stores/user'
import {
  collection, query, where, orderBy, limit, getDocs, startAfter, DocumentSnapshot
} from 'firebase/firestore'

const { $db } = useNuxtApp()
const user = useUserStore()

// --- Roles / supervisor ---
const SUPERVISOR_ROLE = 'jefe_comercial'
const isSupervisor = computed(() => {
  const r = (user.rol || '').toLowerCase()
  const ok = r === SUPERVISOR_ROLE || r.includes('vanes') || (user as any).esSupervisor === true || r === 'admin'
  console.debug('[cotizaciones] rol:', r, 'esSupervisor?', ok, 'flag:', (user as any).esSupervisor)
  return ok
})


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
          // ⚠️ usar el UID real almacenado en el doc, no el id del doc
          uid: data.uid || null,
          nombre: data.nombre || data.displayName || 'Comercial',
          email: data.email || null
        }
      })
      // solo comerciales que tengan uid válido (Auth UID)
      .filter(c => !!c.uid)

  }catch(e){
    console.error('[comerciales] error', e)
    comerciales.value = []
  }
}

// UI
const loading = ref(true)
const search  = ref('')
const status  = ref<'all' | 'pendiente' | 'resuelta' | 'reabierta'>('all')
const page    = ref(1)
const perPage = 9

// Datos de la página actual
const items   = ref<any[]>([])

const cursors = ref<(DocumentSnapshot | null)[]>([null]) // página 1 empieza sin cursor
const hasMore = ref<boolean>(false) // si hay más páginas por delante
const pageCount = computed(() => {
  const known = Math.max(1, cursors.value.length - 1)
  return hasMore.value ? known + 1 : known
})

// Helpers de UI
const statusChip = (s: string) => {
  const k = (s || 'pendiente').toLowerCase()
  return {
    text: k === 'resuelta' ? 'Resuelta' : k === 'reabierta' ? 'Reabierta' : 'Pendiente',
    color: k === 'resuelta' ? 'success' : k === 'reabierta' ? 'primary' : 'warning'
  }
}
const progressByEstado = (estado: string, workflow?: string) => {
  const e = (estado || '').toLowerCase()
  const w = (workflow || '').toLowerCase()

  if (e === 'resuelta') return 100
  if (w === 'en_revision') return 40
  if (w === 'consultando') return 60
  if (w === 'espera_cliente') return 80
  if (e === 'reabierta') return 20

  return 10 // pendiente inicial
}

const progressColor = (estado: string, workflow?: string) => {
  const val = progressByEstado(estado, workflow)
  if (val === 100) return 'success'
  if (val >= 80) return 'secondary'
  if (val >= 60) return 'info'
  if (val >= 40) return 'warning'
  if (val >= 20) return 'primary'
  return 'grey'
}
const totalCotizado = (art: any[]) =>
  (art || []).reduce((a, r) => a + (Number(r.unidades) || 0) * (Number(r.precioCotizado) || 0), 0)
const totalCliente = (art: any[]) =>
  (art || []).reduce((a, r) => a + (Number(r.unidades) || 0) * (Number(r.precioCliente) || 0), 0)
const initials = (name: string) =>
  (name || '—').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')

// Construye la query con filtros y cursor
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

  // --- Filtro por estado ---
  if (status.value !== 'all') {
    if (status.value === 'pendiente') {
      // admite docs con estado == pendiente o estado sin definir (null)
      constraints.push(where('estado','in',['pendiente', null]))
    } else {
      constraints.push(where('estado','==', status.value))
    }
  }

  // --- Búsqueda exacta por cliente ---
  if (search.value.trim()) {
    constraints.push(where('cliente','==', search.value.trim()))
  }

  // --- Orden + límite ---
  constraints.push(orderBy('updatedAt','desc'))
  constraints.push(limit(perPage))

  // --- Cursor ---
  const cursor = cursors.value[forPage]
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
    const q = buildQuery(forPage)
    const snap = await getDocs(q)
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))

    items.value = docs
    hasMore.value = docs.length === perPage
    cursors.value[forPage + 1] = snap.docs[snap.docs.length - 1] || null
  } catch (e: any) {
    console.error('[cotizaciones] error al cargar la página', e)
  } finally {
    loading.value = false
  }
}

// --- Esperar a que el userStore termine antes de la primera carga ---
async function boot() {
  // espera a que el store acabe de cargar
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

// Si cambia el rol o el uid (p. ej., al terminar de cargar el store) → recargar
watch([() => user.uid, () => (user.rol || '').toLowerCase()], () => {
  page.value = 1
  cursors.value = [null]
  loadPage(1)
})

// Cambios de página (v-pagination)
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
            <v-chip value="pendiente" variant="text" class="filter-chip" :class="{ 'filter-chip--active': status==='pendiente' }">
              <Icon name="mdi:progress-clock" class="me-2" /> Pendientes
            </v-chip>
            <v-chip value="reabierta" variant="text" class="filter-chip" :class="{ 'filter-chip--active': status==='reabierta' }">
              <Icon name="mdi:refresh" class="me-2" /> Reabiertas
            </v-chip>
            <v-chip value="resuelta" variant="text" class="filter-chip" :class="{ 'filter-chip--active': status==='resuelta' }">
              <Icon name="mdi:check-decagram" class="me-2" /> Resueltas
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
        <div class="d-flex align-center justify-end ga-3 w-50">
          <v-text-field
            v-model="search"
            variant="outlined"
            density="compact"
            placeholder="Buscar por cliente (igual exacto)…"
            hide-details
            style="max-width: 320px"
          >
            <template #prepend-inner><Icon name="mdi:magnify" /></template>
          </v-text-field>

          <v-btn color="primary" prepend-icon="mdi-plus" rounded="lg" size="large" @click="goNueva">
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
      <v-col cols="12" md="4" v-for="c in items" :key="c.id">
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
                <v-chip :color="statusChip(c.estado).color" size="small" label>
                  {{ statusChip(c.estado).text }}
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
                  {{ progressByEstado(c.estado, c.workflow) }}%
                  ·
                  {{ statusChip(c.estado).text }}
                  <span v-if="c.workflow">· {{ c.workflow.replace('_',' ') }}</span>
                </div>
              </div>
              <v-progress-linear
                :model-value="progressByEstado(c.estado, c.workflow)"
                :color="progressColor(c.estado, c.workflow)"
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

      <v-col cols="12" v-if="!items.length && !loading">
        <v-alert type="info" variant="tonal">
          No hay cotizaciones con esos filtros.
        </v-alert>
      </v-col>
    </v-row>

    <!-- Paginación -->
    <div class="d-flex justify-center mt-6" v-if="pageCount > 1">
      <v-pagination v-model="page" :length="pageCount" rounded="circle" />
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

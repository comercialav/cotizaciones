<script setup lang="ts">
import { useUserStore } from "~/stores/user"
import {
  collection, getDocs, query, where
} from "firebase/firestore"
import { normalizeStockEstado, stockNeedsCompras, pendienteStripState } from "~/utils/stock"
import { TARIFA_CODIGOS, tarifaLabel } from "~/utils/tarifas"
import { sumLineasPrecioCotizado, sumLineasTarifa } from "~/utils/cotizacion-totales"
import { fetchCotizacionesForScope } from '~/utils/cotizacion-access'
import { filterComercialesList } from '~/utils/comerciales'
import { isGanadaCot, isPendienteParaRol, isReabiertaChip } from '~/utils/cotizacion-filtros'

const { $db } = useNuxtApp()
const user = useUserStore()

const loading = ref(true)
const docs = ref<any[]>([])
const comerciales = ref<{uid:string,nombre:string,email?:string}[]>([])
const selectedComercialUid = ref<string|null>(null)

// KPIs
const kpis = reactive({
  total: 0,
  pendientes: 0,
  ganadas: 0,
  reabiertas: 0,
  sinStock: 0,
  totalCotizado: 0,
  descuentoMedioPct: 0,
})

function resetKpis(){
  kpis.total=0;kpis.pendientes=0;kpis.ganadas=0;kpis.reabiertas=0;kpis.sinStock=0
  kpis.totalCotizado=0;kpis.descuentoMedioPct=0
}

function sumLineas(articulos:any[], field:"precioCliente"|"precioCotizado"){
  if (field === 'precioCotizado') return sumLineasPrecioCotizado(articulos)
  return sumLineasTarifa(articulos)
}

// Helpers
const last8 = computed(() =>
  [...docs.value]
    .sort((a,b)=> (b.fechaCreacion?.toMillis?.()||0) - (a.fechaCreacion?.toMillis?.()||0))
    .slice(0,8)
)
const initials = (name: string) =>
  (name || '—').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('')

// Series días últimos 30
const days = Array.from({length: 30}).map((_,i)=>{
  const d = new Date(); d.setDate(d.getDate()- (29-i))
  const key = d.toISOString().slice(0,10)
  return { key, label: d.toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit"}), count:0 }
})
const seriesDias = ref<number[]>(days.map(()=>0))
const labelsDias = ref<string[]>(days.map(d=>d.label))

// Dona estados
const donutSeries = ref<number[]>([0,0,0])
const donutLabels = ["Pendiente","Ganada","Reabierta"]

// Tarifas
const tarifas = TARIFA_CODIGOS
const tarifasCounts = ref<number[]>(tarifas.map(()=>0))

// Ranking por comercial (solo supervisora)
const rankingSeries = ref<any[]>([])
const rankingCategories = ref<string[]>([])
const rankingComerciales = ref<{ nombre: string; uid: string | null; total: number; ganadas: number }[]>([])

// Top clientes (solo supervisora)
const topClientes = ref<{cliente:string,total:number}[]>([])

// Detectar si es supervisora
const isSupervisor = computed(()=> user.isSupervisor || user.isCompras)

function listTo(params: Record<string, string | undefined> = {}) {
  const q = new URLSearchParams()
  const comercial = params.comercial ?? selectedComercialUid.value ?? undefined
  if (comercial) q.set('comercial', comercial)
  for (const [k, v] of Object.entries(params)) {
    if (k === 'comercial' || !v) continue
    q.set(k, v)
  }
  const qs = q.toString()
  return qs ? `/cotizaciones?${qs}` : '/cotizaciones'
}

function kpiTo(key: string) {
  switch (key) {
    case 'pendientes': return listTo({ status: 'Pendiente' })
    case 'ganadas': return listTo({ status: 'Ganadas' })
    case 'reabiertas': return listTo({ status: 'Reabiertas' })
    case 'sinStock': return listTo({ stock: 'sin' })
    case 'cotizado': return listTo({ status: 'Cotizadas' })
    default: return listTo()
  }
}

function last30DaysLink() {
  const hasta = new Date()
  const desde = new Date()
  desde.setDate(desde.getDate() - 29)
  return listTo({
    fechaDesde: desde.toISOString().slice(0, 10),
    fechaHasta: hasta.toISOString().slice(0, 10),
  })
}

const estadoLinks = computed(() => [
  { key: 'pendientes', label: 'Pendiente', color: '#f59e0b', count: donutSeries.value[0] || 0 },
  { key: 'ganadas', label: 'Ganada', color: '#16a34a', count: donutSeries.value[1] || 0 },
  { key: 'reabiertas', label: 'Reabierta', color: '#3b82f6', count: donutSeries.value[2] || 0 },
])

const tarifasLinks = computed(() =>
  tarifas
    .map((tarifa, i) => ({ tarifa, label: tarifaLabel(tarifa), count: tarifasCounts.value[i] || 0 }))
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count)
)

function estadoToLink(key: string) {
  return kpiTo(key === 'pendientes' ? 'pendientes' : key === 'ganadas' ? 'ganadas' : 'reabiertas')
}

function comercialToLink(c: { uid: string | null }) {
  return c.uid ? listTo({ comercial: c.uid }) : listTo()
}

function onRankingClick(_event: unknown, _chart: unknown, config: { dataPointIndex?: number }) {
  const idx = config?.dataPointIndex
  if (idx == null || idx < 0) return
  const c = rankingComerciales.value[idx]
  if (c) navigateTo(comercialToLink(c))
}

function estadoRowLink(estado?: string) {
  const e = (estado || 'pendiente').toLowerCase()
  if (e === 'reabierta') return listTo({ status: 'Reabiertas' })
  if (e === 'ganada') return listTo({ status: 'Ganadas' })
  if (e === 'perdida') return listTo({ status: 'Perdidas' })
  if (e === 'resuelta') return listTo({ status: 'Cotizadas' })
  return listTo({ status: 'Pendiente' })
}

const kpiCards = computed(() => [
  { key: 'all', label: 'Solicitudes', val: kpis.total, icon: 'mdi:clipboard-text-outline', color: '#3b82f6' },
  { key: 'pendientes', label: 'Pendientes', val: kpis.pendientes, icon: 'mdi:progress-clock', color: '#f59e0b' },
  { key: 'ganadas', label: 'Ganadas', val: kpis.ganadas, icon: 'mdi:trophy', color: '#16a34a' },
  { key: 'reabiertas', label: 'Reabiertas', val: kpis.reabiertas, icon: 'mdi:refresh', color: '#3b82f6' },
  { key: 'sinStock', label: 'Sin stock / parcial', val: kpis.sinStock, icon: 'mdi:cart-off', color: '#ef4444' },
  { key: 'cotizado', label: 'Total cotizado', val: `€ ${kpis.totalCotizado.toFixed(2)}`, icon: 'mdi:currency-eur', color: '#0ea5e9' },
])

async function loadComerciales(){
  const qs = await getDocs(query(collection($db,"usuarios"), where("rol","==","comercial")))
  comerciales.value = qs.docs.map(d=>{
    const data=d.data() as any
    return {
      uid: data.authUid || data.uid || d.id,
      nombre: data.nombre||data.email||"Comercial",
      email: data.email
    }
  }).filter(c => !!c.uid)
  comerciales.value = filterComercialesList(comerciales.value)
}

function normNombre(s?: string | null) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim()
}

function resolveVendedorUid(vendedor: any): string | null {
  const direct = vendedor?.uid || vendedor?.authUid
  if (direct) return String(direct)
  const nombre = normNombre(vendedor?.nombre)
  const email = normNombre(vendedor?.email)
  for (const c of comerciales.value) {
    if (nombre && normNombre(c.nombre) === nombre) return c.uid
    if (email && normNombre(c.email) === email) return c.uid
  }
  return null
}

// Recalcular KPIs y series
function computeStats(){
  resetKpis()
  seriesDias.value = days.map(()=>0)
  tarifasCounts.value = tarifas.map(()=>0)
  donutSeries.value = [0,0,0]

  const mapCom:Record<string,{nombre:string,uid:string|null,total:number,ganadas:number}> = {}
  const mapClientes:Record<string,number> = {}

  for(const d of docs.value){
    kpis.total++
    // Misma lógica que chips del listado (Pendiente / Reabiertas)
    if (isPendienteParaRol(d, { isSupervisor: user.isSupervisor, isCompras: user.isCompras })) {
      kpis.pendientes++
    }
    if (isReabiertaChip(d)) kpis.reabiertas++
    if(isGanadaCot(d)) kpis.ganadas++
    if(stockNeedsCompras(normalizeStockEstado(d))) kpis.sinStock++

    const totCot = sumLineasPrecioCotizado(d.articulos)
    const totCli = sumLineasTarifa(d.articulos)
    kpis.totalCotizado += totCot
    const descPct = totCli > 0 && totCot > 0 ? (1 - (totCot / totCli)) * 100 : 0
    if (totCot > 0) kpis.descuentoMedioPct += descPct

    if (isPendienteParaRol(d, { isSupervisor: user.isSupervisor, isCompras: user.isCompras })) {
      donutSeries.value[0]++
    }
    if (isGanadaCot(d)) donutSeries.value[1]++
    if (isReabiertaChip(d)) donutSeries.value[2]++

    const idx=tarifas.indexOf(d.tarifa)
    if(idx>=0) tarifasCounts.value[idx]++

    const ts=d.fechaCreacion?.toDate?.()||d.fechaCreacion||null
    if(ts){
      const key=new Date(ts).toISOString().slice(0,10)
      const di=days.findIndex(x=>x.key===key)
      if(di>=0) seriesDias.value[di]+=1
    }

    // Supervisor: ranking comercial y top clientes
    if(isSupervisor.value){
      const vend=d.vendedor?.nombre||"?"
      const uid=resolveVendedorUid(d.vendedor)
      if(!mapCom[vend]) mapCom[vend]={nombre:vend,uid,total:0,ganadas:0}
      else if(!mapCom[vend].uid && uid) mapCom[vend].uid = uid
      mapCom[vend].total++
      if(isGanadaCot(d)) mapCom[vend].ganadas++

      const cli=d.cliente||"?"
      mapClientes[cli]=(mapClientes[cli]||0)+totCot
    }
  }
  if (kpis.total > 0) {
    const conCotizado = docs.value.filter(d => sumLineasPrecioCotizado(d.articulos) > 0).length
    kpis.descuentoMedioPct = conCotizado > 0 ? kpis.descuentoMedioPct / conCotizado : 0
  }

  if(isSupervisor.value){
    const comList = Object.values(mapCom).sort((a, b) => b.total - a.total)
    rankingComerciales.value = comList
    rankingCategories.value = comList.map(c => c.nombre)
    rankingSeries.value = [
      { name: 'Total', data: comList.map(c => c.total) },
      { name: 'Ganadas', data: comList.map(c => c.ganadas) },
    ]
    topClientes.value=Object.entries(mapClientes)
      .map(([cliente,total])=>({cliente,total}))
      .sort((a,b)=>b.total-a.total)
      .slice(0,5)
  }
}

async function loadData(){
  loading.value=true
  try{
    docs.value = await fetchCotizacionesForScope($db as any, {
      isSupervisor: isSupervisor.value,
      scopeUids: user.scopeUids?.length ? user.scopeUids : (user.uid ? [user.uid] : []),
      userEmail: user.email,
      selectedComercialUid: selectedComercialUid.value,
      selectedComercialEmail: comerciales.value.find(c => c.uid === selectedComercialUid.value)?.email || null,
      max: 500,
    })
    computeStats()
  }finally{
    loading.value=false
  }
}

onMounted(async()=>{
  if(isSupervisor.value) await loadComerciales()
  await loadData()
})

watch(selectedComercialUid,()=>{ if(isSupervisor.value) loadData() })

// Apex options
const barOpts = computed(()=>({
  chart:{type:"bar",height:260,toolbar:{show:false}},
  plotOptions:{bar:{columnWidth:"50%",borderRadius:6}},
  dataLabels:{enabled:false},
  xaxis:{categories:labelsDias.value},
  grid:{strokeDashArray:4},
  colors:["#5b9cff"]
}))
const donutOpts = {
  chart:{type:"donut"},labels:donutLabels,dataLabels:{enabled:false},
  legend:{position:"bottom"},colors:["#f59e0b","#16a34a","#3b82f6"]
}
const tarifasOpts = {
  chart:{type:"bar",height:260,toolbar:{show:false}},
  plotOptions:{bar:{horizontal:true,borderRadius:6}},
  xaxis:{categories:tarifas},dataLabels:{enabled:false},
  colors:["#22c55e"],grid:{strokeDashArray:4}
}
const rankingOpts = computed(()=>({
  chart:{type:"bar",height:260,stacked:true,toolbar:{show:false},selection:{enabled:true}},
  xaxis:{categories:rankingCategories.value},
  plotOptions:{bar:{borderRadius:4}},
  dataLabels:{enabled:false},
  colors:["#3b82f6","#16a34a"]
}))
</script>

<template>
  <v-container class="py-6">
    <div class="d-flex">
      <div class="intro w-66">
          <div class="mb-4" v-if="isSupervisor">
             <h2 class="text-2xl font-bold">
               Hola, {{ user.nombre }} 👋 ({{ user.isCompras ? 'Compras' : 'Supervisora' }})
             </h2>
             <p class="text-gray-500">
               Resumen de {{ user.isCompras ? 'todas las cotizaciones' : 'todos los comerciales' }}
             </p>
           </div>
        <div class="mb-4" v-else> <h2 class="text-2xl font-bold">Hola, {{ user.nombre || 'Vendedor' }} 👋</h2> <p class="text-gray-500">Tu resumen de cotizaciones</p> </div>
      </div>
      <!-- Selector supervisor -->
      <div v-if="isSupervisor" class="w-33 d-flex justify-end align-center">
      <Icon name="mdi:account-supervisor" class="mr-2" style="font-size:32px;color:#6b7280"/>
        <v-select
        v-if="isSupervisor"
        v-model="selectedComercialUid"
        :items="[{uid:null,nombre:'Todos'},...comerciales]"
        item-title="nombre" item-value="uid"
        label="Filtrar por comercial" variant="outlined"
        density="comfortable" hide-details style="max-width:300px; max-height:56px"
        />
      </div>
    </div>

    <v-skeleton-loader v-if="loading" type="image, article, table, card, list-item-two-line" />

    <template v-else>
      
      

      <!-- KPIs -->
      <v-row class="mb-4">
        <v-col cols="12" md="2" v-for="card in kpiCards" :key="card.key">
          <NuxtLink :to="kpiTo(card.key)" class="kpi-link">
            <v-card class="kpi-card">
              <v-card-text class="flex items-center gap-3">
                <div class="icon" :style="{ background: card.color+'22', color: card.color }">
                  <Icon :name="card.icon"/>
                </div>
                <div>
                  <div class="text-sm text-gray-600">{{ card.label }}</div>
                  <div class="text-xl font-bold">{{ card.val }}</div>
                </div>
              </v-card-text>
            </v-card>
          </NuxtLink>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="8">
          <NuxtLink :to="last30DaysLink()" class="dash-link">
            <v-card class="dash-card">
              <v-card-title class="pb-0 d-flex justify-space-between align-center">
                <span>Cotizaciones por día (30 días)</span>
                <span class="dash-card__action">Ver listado →</span>
              </v-card-title>
              <v-card-text>
                <ClientOnly>
                  <ApexChart type="bar" height="260"
                    :options="barOpts" :series="[{name:'Solicitudes', data:seriesDias}]"
                  />
                </ClientOnly>
              </v-card-text>
            </v-card>
          </NuxtLink>
        </v-col>
        <v-col cols="12" md="4">
          <v-card class="dash-card">
            <v-card-title class="pb-0">Estados</v-card-title>
            <v-card-text>
              <ClientOnly>
                <ApexChart type="donut" height="220"
                  :options="donutOpts" :series="donutSeries"
                />
              </ClientOnly>
              <div class="dash-chips">
                <NuxtLink
                  v-for="e in estadoLinks"
                  :key="e.key"
                  :to="estadoToLink(e.key)"
                  class="dash-chip"
                  :style="{ '--chip-color': e.color }"
                >
                  <span class="dash-chip__dot" />
                  {{ e.label }} ({{ e.count }})
                </NuxtLink>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-row class="mt-4">
        <v-col cols="12" md="6">
          <v-card class="dash-card">
            <v-card-title class="pb-0 d-flex justify-space-between align-center">
              <span>Tarifas más usadas</span>
              <NuxtLink :to="listTo()" class="dash-card__action">Ver todas →</NuxtLink>
            </v-card-title>
            <v-card-text>
              <ClientOnly>
                <ApexChart type="bar" height="260"
                  :options="tarifasOpts" :series="[{name:'Solicitudes',data:tarifasCounts}]"
                />
              </ClientOnly>
              <div v-if="tarifasLinks.length" class="dash-chips">
                <NuxtLink
                  v-for="t in tarifasLinks"
                  :key="t.tarifa"
                  :to="listTo({ tarifa: t.tarifa })"
                  class="dash-chip dash-chip--tarifa"
                >
                  {{ t.label }} ({{ t.count }})
                </NuxtLink>
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="6">
          <v-card class="dash-card">
            <v-card-title class="pb-0 d-flex justify-space-between align-center">
              <span>Solicitudes recientes</span>
              <NuxtLink :to="listTo()" class="dash-card__action">Ver todas →</NuxtLink>
            </v-card-title>
            <v-card-text>
              <v-table density="comfortable" class="dash-table">
                <thead><tr><th>Nº</th><th>Cliente</th><th>Estado</th><th class="text-right">Total</th></tr></thead>
                <tbody>
                  <tr
                    v-for="r in last8"
                    :key="r.id"
                    class="dash-table__row"
                    @click="navigateTo(`/cotizaciones/${r.id}`)"
                  >
                    <td>{{ r.numero }}</td>
                    <td>{{ r.cliente }}</td>
                    <td>
                      <NuxtLink :to="estadoRowLink(r.estado)" @click.stop>
                        <v-chip :color="r.estado==='ganada'?'success':(r.estado==='pendiente'?'warning':(r.estado==='perdida'?'error':'primary'))" size="small">
                          {{ r.estado === 'ganada' ? 'Ganada' : r.estado === 'perdida' ? 'Perdida' : r.estado }}
                        </v-chip>
                      </NuxtLink>
                      <span
                        v-if="user.canVerPendienteCompras && pendienteStripState(r, { forCompras: user.isCompras })"
                        class="dash-pendiente-compras"
                        :class="pendienteStripState(r, { forCompras: user.isCompras })!.kind === 'supervisor' ? 'dash-pendiente-compras--supervisor' : 'dash-pendiente-compras--compras'"
                      >
                        <Icon :name="pendienteStripState(r, { forCompras: user.isCompras })!.kind === 'supervisor' ? 'mdi:account-supervisor-outline' : 'mdi:clipboard-text-clock-outline'" />
                        {{ pendienteStripState(r, { forCompras: user.isCompras })!.meta.title }}
                      </span>
                    </td>
                    <td class="text-right">€ {{ sumLineas(r.articulos, 'precioCotizado').toFixed(2) }}</td>
                  </tr>
                  <tr v-if="last8.length===0">
                    <td colspan="4" class="text-center text-gray-500">Sin solicitudes aún</td>
                  </tr>
                </tbody>
              </v-table>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Extra para supervisor -->
      <v-row v-if="isSupervisor" class="mt-4">
        <v-col cols="12" md="6">
          <v-card class="dash-card">
            <v-card-title class="pb-0 d-flex justify-space-between align-center">
              <span>Ranking por comercial</span>
              <NuxtLink :to="listTo()" class="dash-card__action">Ver todas →</NuxtLink>
            </v-card-title>
            <v-card-text>
              <ClientOnly>
                <ApexChart
                  type="bar"
                  height="260"
                  :options="rankingOpts"
                  :series="rankingSeries"
                  @dataPointSelection="onRankingClick"
                />
              </ClientOnly>
              <div v-if="rankingComerciales.length" class="dash-list">
                <NuxtLink
                  v-for="c in rankingComerciales"
                  :key="c.nombre"
                  :to="comercialToLink(c)"
                  class="dash-list__item"
                >
                  <span>{{ c.nombre }}</span>
                  <span class="dash-list__meta">{{ c.total }} cotizaciones · {{ c.ganadas }} ganadas</span>
                </NuxtLink>
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="6">
          <v-card class="dash-card">
            <v-card-title class="pb-0 d-flex justify-space-between align-center">
              <span>Top clientes (por € cotizado)</span>
              <NuxtLink :to="listTo()" class="dash-card__action">Ver todas →</NuxtLink>
            </v-card-title>
            <v-card-text>
              <v-table class="dash-table">
                <thead><tr><th>Cliente</th><th class="text-right">Total</th></tr></thead>
                <tbody>
                  <tr
                    v-for="c in topClientes"
                    :key="c.cliente"
                    class="dash-table__row"
                    @click="navigateTo(listTo({ search: c.cliente }))"
                  >
                    <td>{{ c.cliente }}</td>
                    <td class="text-right">€ {{ c.total.toFixed(2) }}</td>
                  </tr>
                  <tr v-if="topClientes.length===0">
                    <td colspan="2" class="text-center text-gray-500">Sin datos</td>
                  </tr>
                </tbody>
              </v-table>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </v-container>
</template>

<style scoped>
.kpi-link, .dash-link { display: block; text-decoration: none; color: inherit; }
.kpi-card, .dash-card {
  border-radius: 16px;
  transition: transform .15s ease, box-shadow .15s ease;
}
.kpi-card { cursor: pointer; }
.kpi-link:hover .kpi-card,
.dash-link:hover .dash-card {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(2, 6, 23, 0.1);
}
.dash-card__action {
  font-size: 13px;
  font-weight: 600;
  color: #1976d2;
  text-decoration: none;
}
.dash-card__action:hover { text-decoration: underline; }
.dash-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.dash-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition: background-color .15s ease, color .15s ease;
}
.dash-chip:hover { background: #e2e8f0; color: #0f172a; }
.dash-chip__dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--chip-color, #64748b);
}
.dash-chip--tarifa { background: #ecfdf5; color: #047857; }
.dash-chip--tarifa:hover { background: #d1fae5; }
.dash-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}
.dash-list__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f8fafc;
  text-decoration: none;
  color: inherit;
  transition: background-color .15s ease;
}
.dash-list__item:hover { background: #eef2ff; }
.dash-list__meta { font-size: 12px; color: #64748b; white-space: nowrap; }
.dash-table__row { cursor: pointer; transition: background-color .15s ease; }
.dash-table__row:hover { background: #f8fafc; }
.dash-pendiente-compras{
  display:inline-flex;
  align-items:center;
  gap:4px;
  margin-top:5px;
  padding:2px 8px;
  border-radius:999px;
  font-size:.7rem;
  font-weight:600;
  line-height:1.3;
}
.dash-pendiente-compras--compras{
  color:#4338ca;
  background:#eef2ff;
  border:1px solid rgba(99, 102, 241, 0.15);
}
.dash-pendiente-compras--supervisor{
  color:#0369a1;
  background:#e0f2fe;
  border:1px solid rgba(14, 165, 233, 0.18);
}
.icon{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;}
.text-gray-500{color:#6b7280}
.text-gray-600{color:#4b5563}
</style>

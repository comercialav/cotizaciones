<script setup lang="ts">
import { useUserStore } from "~/stores/user"
import {
  collection, getDocs, query, where
} from "firebase/firestore"

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
  resueltas: 0,
  reabiertas: 0,
  sinStock: 0,
  totalCotizado: 0,
  descuentoMedioPct: 0,
})

function resetKpis(){
  kpis.total=0;kpis.pendientes=0;kpis.resueltas=0;kpis.reabiertas=0;kpis.sinStock=0
  kpis.totalCotizado=0;kpis.descuentoMedioPct=0
}

function sumLineas(articulos:any[], field:"precioSolicitado"|"precioCliente"){
  return (articulos||[]).reduce((a,r)=> a + (Number(r.unidades)||0)*(Number(r[field])||0),0)
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
const donutLabels = ["Pendiente","Resuelta","Reabierta"]

// Tarifas
const tarifas = ["A1","A2","A3","A4","A5","A6","A7"]
const tarifasCounts = ref<number[]>(tarifas.map(()=>0))

// Ranking por comercial (solo supervisora)
const rankingSeries = ref<any[]>([])
const rankingCategories = ref<string[]>([])

// Top clientes (solo supervisora)
const topClientes = ref<{cliente:string,total:number}[]>([])

// Detectar si es supervisora
const isSupervisor = computed(()=> user.rol==="jefe_comercial" || user.esSupervisor===true)

async function loadComerciales(){
  const qs = await getDocs(query(collection($db,"usuarios"), where("rol","==","comercial")))
  comerciales.value = qs.docs.map(d=>{
    const data=d.data() as any
    return { uid:data.uid||d.id, nombre:data.nombre||data.email||"Comercial", email:data.email }
  })
}

// Recalcular KPIs y series
function computeStats(){
  resetKpis()
  seriesDias.value = days.map(()=>0)
  tarifasCounts.value = tarifas.map(()=>0)
  donutSeries.value = [0,0,0]

  const mapCom:Record<string,{nombre:string,total:number,resueltas:number}> = {}
  const mapClientes:Record<string,number> = {}

  for(const d of docs.value){
    const estado=(d.estado||"pendiente").toLowerCase()
    kpis.total++
    if(estado==="pendiente") kpis.pendientes++
    if(estado==="resuelta") kpis.resueltas++
    if(estado==="reabierta") kpis.reabiertas++
    if(d.stockDisponible===false) kpis.sinStock++

    const totCot=sumLineas(d.articulos,"precioSolicitado")
    const totCli=sumLineas(d.articulos,"precioCliente")
    kpis.totalCotizado+=totCot
    const descPct=totCli>0?(1-(totCot/totCli))*100:0
    kpis.descuentoMedioPct+=descPct

    if(estado==="pendiente") donutSeries.value[0]++
    if(estado==="resuelta") donutSeries.value[1]++
    if(estado==="reabierta") donutSeries.value[2]++

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
      if(!mapCom[vend]) mapCom[vend]={nombre:vend,total:0,resueltas:0}
      mapCom[vend].total++
      if(estado==="resuelta") mapCom[vend].resueltas++

      const cli=d.cliente||"?"
      mapClientes[cli]=(mapClientes[cli]||0)+totCot
    }
  }
  if(kpis.total>0) kpis.descuentoMedioPct/=kpis.total

  if(isSupervisor.value){
    rankingCategories.value=Object.values(mapCom).map(c=>c.nombre)
    rankingSeries.value=[
      {name:"Total", data:Object.values(mapCom).map(c=>c.total)},
      {name:"Resueltas", data:Object.values(mapCom).map(c=>c.resueltas)}
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
    let q
    if(isSupervisor.value){
      q=collection($db,"cotizaciones")
      if(selectedComercialUid.value){
        q=query(q, where("vendedor.uid","==",selectedComercialUid.value))
      }
    }else{
      q=query(collection($db,"cotizaciones"), where("vendedor.uid","==",user.uid))
    }
    const snap=await getDocs(q)
    docs.value=snap.docs.map(d=>({id:d.id,...d.data()}))
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
  chart:{type:"bar",height:260,stacked:true,toolbar:{show:false}},
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
            Hola, {{ user.nombre }} 👋 (Supervisora)
          </h2>
          <p class="text-gray-500">
            Resumen de todos los comerciales
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
        <v-col cols="12" md="2" v-for="card in [
          {label:'Solicitudes', val:kpis.total, icon:'mdi:clipboard-text-outline', color:'#3b82f6'},
          {label:'Pendientes',  val:kpis.pendientes, icon:'mdi:progress-clock',  color:'#f59e0b'},
          {label:'Resueltas',   val:kpis.resueltas,  icon:'mdi:check-decagram', color:'#16a34a'},
          {label:'Reabiertas',  val:kpis.reabiertas, icon:'mdi:refresh',        color:'#3b82f6'},
          {label:'Sin stock',   val:kpis.sinStock,   icon:'mdi:cart-off',       color:'#ef4444'},
          {label:'Total cotizado', val:`€ ${kpis.totalCotizado.toFixed(2)}`, icon:'mdi:currency-eur', color:'#0ea5e9'},
        ]" :key="card.label">
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
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="8">
          <v-card>
            <v-card-title class="pb-0">Cotizaciones por día (30 días)</v-card-title>
            <v-card-text>
              <ClientOnly>
                <apexchart type="bar" height="260"
                  :options="barOpts" :series="[{name:'Solicitudes', data:seriesDias}]"
                />
              </ClientOnly>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="4">
          <v-card>
            <v-card-title class="pb-0">Estados</v-card-title>
            <v-card-text>
              <ClientOnly>
                <apexchart type="donut" height="260"
                  :options="donutOpts" :series="donutSeries"
                />
              </ClientOnly>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-row class="mt-4">
        <v-col cols="12" md="6">
          <v-card>
            <v-card-title class="pb-0">Tarifas más usadas</v-card-title>
            <v-card-text>
              <ClientOnly>
                <apexchart type="bar" height="260"
                  :options="tarifasOpts" :series="[{name:'Solicitudes',data:tarifasCounts}]"
                />
              </ClientOnly>
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="6">
          <v-card>
            <v-card-title class="pb-0">Solicitudes recientes</v-card-title>
            <v-card-text>
              <v-table density="comfortable">
                <thead><tr><th>Nº</th><th>Cliente</th><th>Estado</th><th class="text-right">Total</th></tr></thead>
                <tbody>
                  <tr v-for="r in last8" :key="r.id">
                    <td>{{r.numero}}</td>
                    <td>{{r.cliente}}</td>
                    <td><v-chip :color="r.estado==='resuelta'?'success':(r.estado==='pendiente'?'warning':'primary')" size="small">{{r.estado}}</v-chip></td>
                    <td class="text-right">€ {{ sumLineas(r.articulos,'precioSolicitado').toFixed(2) }}</td>
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
          <v-card>
            <v-card-title class="pb-0">Ranking por comercial</v-card-title>
            <v-card-text>
              <ClientOnly>
                <apexchart type="bar" height="260"
                  :options="rankingOpts" :series="rankingSeries"
                />
              </ClientOnly>
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="6">
          <v-card>
            <v-card-title class="pb-0">Top clientes (por € cotizado)</v-card-title>
            <v-card-text>
              <v-table>
                <thead><tr><th>Cliente</th><th class="text-right">Total</th></tr></thead>
                <tbody>
                  <tr v-for="c in topClientes" :key="c.cliente">
                    <td>{{c.cliente}}</td>
                    <td class="text-right">€ {{c.total.toFixed(2)}}</td>
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
.kpi-card{border-radius:16px;}
.icon{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;}
.text-gray-500{color:#6b7280}
.text-gray-600{color:#4b5563}
</style>

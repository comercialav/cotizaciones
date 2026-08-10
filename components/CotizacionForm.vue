<script setup lang="ts">
import { useCotizacionesStore } from "~/stores/cotizaciones"
import { useUserStore } from "~/stores/user"
import { getDocs, collection, deleteDoc, doc } from "firebase/firestore"
import { ref as storageRef, deleteObject } from "firebase/storage"
import {
  type StockEstado,
  STOCK_OPCIONES,
  normalizeStockEstado,
  stockDisponibleLegacy,
  stockNeedsCompras,
} from "~/utils/stock"
import { TIPO_ENTREGA_OPCIONES, type TipoEntrega } from "~/utils/entrega"
import { mapArticuloCompradoAntes, mergeArticuloEdicion, hydrateArticuloIdentidad, buildArticuloIdentidad, validarArticuloIdentidad } from "~/utils/articulos"
import { isRichTextEmpty } from "~/utils/format-text"
import { isTipoEntregaValid } from "~/utils/entrega"
import { tarifaSelectItems } from "~/utils/tarifas"

type Row = {
  codigoProducto: string
  descripcionProducto: string
  articulo: string
  url: string
  unidades: number
  precioCliente: number
  precioSolicitado?: number
  precioCompetencia?: number
  precioCoste?: number | null
  proveedor?: string | null
  compradoAntes?: boolean
  precioAnterior?: number | null
  mostrarSolicitado?: boolean
  mostrarCompetencia?: boolean
}
type AdjuntoDB = {
  id: string
  nombre: string
  url: string
  tipo?: string | null
  size?: number | null
  path?: string | null
}

const props = defineProps<{
  mode?: 'create' | 'edit'
  initial?: any
  loading?: boolean
  detailUrl?: string
  articulosOnly?: boolean
  unlockArticulos?: boolean
}>()
const emit = defineEmits<{ (e:'submit', payload:any): void }>()

const { $db, $storage, $auth } = useNuxtApp()
const cotStore = useCotizacionesStore()
const user = useUserStore()

/** Vista de artículos adaptada para Compras (sin solicitado/compra ant., con coste) */
const isComprasArticlesView = computed(() => user.isCompras)

async function ensureAuth() {
  if ($auth.currentUser) return
  const { signInAnonymously } = await import('firebase/auth')
  await signInAnonymously($auth)
}

const cliente = ref("")
const tarifa  = ref<string | null>(null)
const condicionesEspeciales = ref("")
const tarifas = tarifaSelectItems()
const fechaDecision = ref<string | null>(null)

const articulos = ref<Row[]>([
  {
    codigoProducto: '', descripcionProducto: '', articulo: '',
    url: "", unidades: 1, precioCliente: 0,
    precioSolicitado: undefined, precioCompetencia: undefined,
    precioCoste: null,
    proveedor: '',
    compradoAntes: false, precioAnterior: null,
    mostrarSolicitado: false, mostrarCompetencia: false,
  },
])

const originalCount = ref(0)
const isLocked = (i: number) => {
  if (props.unlockArticulos) return false
  return props.mode === 'edit' && i < originalCount.value
}

const errores = ref<string[]>([])

const urlDialog = ref(false)
const urlDraft  = ref("")
const urlIndex  = ref<number|null>(null)
function openUrlDialog(i:number){
  urlIndex.value=i
  urlDraft.value=articulos.value[i].url||""
  urlDialog.value=true
}
function saveUrl(){
  if(urlIndex.value!==null){
    articulos.value[urlIndex.value].url=(urlDraft.value||"").trim()
  }
  urlDialog.value=false
}

// ======= ADJUNTOS =======
const adjuntos = ref<File[]>([])
const adjuntosPicker = ref<File[]>([])
const adjuntosDB = ref<AdjuntoDB[]>([])
const MAX_ADJUNTO = 10 * 1024 * 1024

async function cargarAdjuntosDB() {
  if (props.mode !== 'edit' || !props.initial?.id) return
  console.group('[FORM] cargarAdjuntosDB')
  try {
    const qs = await getDocs(collection($db, 'cotizaciones', props.initial.id, 'adjuntos'))
    adjuntosDB.value = qs.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
    console.table(adjuntosDB.value.map(a => ({ id:a.id, nombre:a.nombre, size:a.size, path:a.path })))
  } catch (e) {
    console.error('[FORM] cargarAdjuntosDB error:', e)
  } finally {
    console.groupEnd()
  }
}

async function eliminarAdjuntoDB(a: AdjuntoDB) {
  console.group('[FORM] eliminarAdjuntoDB')
  console.log('a:', a)
  await ensureAuth()
  try {
    await deleteDoc(doc($db, 'cotizaciones', props.initial.id, 'adjuntos', a.id))
    console.log('✓ Doc adjunto borrado en Firestore:', a.id)
  } catch (e) {
    console.error('× Error borrando doc Firestore:', e)
  } finally {
    // Intentar borrar el fichero en Storage
    try {
      const refToDel = storageRef($storage, a.path || a.url)
      await deleteObject(refToDel)
      console.log('✓ Fichero borrado en Storage:', a.path || a.url)
    } catch (e) {
      console.warn('! No se pudo borrar en Storage (puede que no tengamos path):', e)
    }
  }
  adjuntosDB.value = adjuntosDB.value.filter(x => x.id !== a.id)
  console.groupEnd()
}

// ======= INIT EDICIÓN =======
onMounted(async () => {
  console.group('[FORM] onMounted')
  console.log('mode:', props.mode, 'initial.id:', props.initial?.id)
  if (props.mode === "edit" && props.initial) {
    console.log('initial:', props.initial)
    cliente.value = props.initial.cliente || ""
    tarifa.value  = props.initial.tarifa  || ""
    condicionesEspeciales.value = props.initial.condicionesEspeciales || ""

    const legacyCompra = {
      compradoAntes: !!props.initial.compradoAntes,
      precioAnterior: props.initial.precioAnterior ?? null,
    }
    const base = (props.initial.articulos?.length
      ? props.initial.articulos
      : [{ codigoProducto:"", descripcionProducto:"", articulo:"", url:"", unidades:0, precioCliente:0 }])
      .map((a:any, idx:number) => {
        const compra = mapArticuloCompradoAntes(a, idx, legacyCompra)
        const identidad = hydrateArticuloIdentidad(a)
        return {
          codigoProducto: identidad.codigoProducto,
          descripcionProducto: identidad.descripcionProducto,
          articulo: identidad.articulo,
          url: a.url || "",
          unidades: Number(a.unidades)||1,
          precioCliente: Number(a.precioCliente)||0,
          precioSolicitado: a.precioSolicitado!=null ? Number(a.precioSolicitado) : undefined,
          precioCompetencia: a.precioCompetencia!=null ? Number(a.precioCompetencia) : undefined,
          precioCoste: a.precioCoste != null ? Number(a.precioCoste) : null,
          proveedor: a.proveedor ? String(a.proveedor).trim() : '',
          compradoAntes: compra.compradoAntes,
          precioAnterior: compra.precioAnterior,
          mostrarSolicitado: a.precioSolicitado != null,
          mostrarCompetencia: a.precioCompetencia != null,
        }
      })
    articulos.value = base
    originalCount.value = base.length
    console.log('originalCount:', originalCount.value)

    // resto de campos
    stockEstado.value = normalizeStockEstado(props.initial)
    licitacion.value      = !!props.initial.licitacion
    clienteFinal.value    = props.initial.clienteFinal || ""
    comentarios.value     = props.initial.comentariosCliente || ""
    formaPagoSolicitada.value = props.initial?.formaPagoSolicitada || ""
    formaPagoActual.value = props.initial?.formaPagoActual || ""
    plazoEntrega.value    = props.initial?.plazoEntrega || ""
    lugarEntrega.value    = props.initial?.lugarEntrega || ""
    tipoEntrega.value     = props.initial?.tipoEntrega || ""
    comentarioStock.value = props.initial?.comentarioStock || ""
    precioCompet.value    = props.initial.precioCompet || null
    fechaDecision.value   = props.initial.fechaDecision || null

    await cargarAdjuntosDB()
  }
  console.groupEnd()
})

// ======= acciones artículos =======
function addArticulo() {
  articulos.value.push({
    codigoProducto: '', descripcionProducto: '', articulo: '',
    url: "", unidades: 1, precioCliente: 0,
    precioSolicitado: undefined, precioCompetencia: undefined,
    precioCoste: null,
    proveedor: '',
    compradoAntes: false, precioAnterior: null,
    mostrarSolicitado: false, mostrarCompetencia: false,
  })
  console.log('[FORM] addArticulo -> total filas:', articulos.value.length)
}
function removeArticulo(i:number){
  if (isLocked(i)) {
    console.warn('[FORM] removeArticulo bloqueado (fila original):', i)
    return
  }
  articulos.value.splice(i,1)
  console.log('[FORM] removeArticulo OK. total filas:', articulos.value.length)
}

// ======= campos adicionales =======
const stockEstado = ref<StockEstado>('con_stock')
const stockOpciones = STOCK_OPCIONES
const avisaCompras = computed(() => stockNeedsCompras(stockEstado.value))
const licitacion      = ref(false)
const clienteFinal    = ref("")
const precioCompet    = ref<number | null>(null)
const comentarios     = ref("")
const formaPagoSolicitada = ref("")
const formaPagoActual = ref("")
const plazoEntrega  = ref("")
const lugarEntrega  = ref("")
const tipoEntrega   = ref<TipoEntrega | "">("")
const tipoEntregaOpciones = TIPO_ENTREGA_OPCIONES
const comentarioStock = ref("")

// ======= totales =======
const totalCliente  = computed(()=> articulos.value.reduce((a,r)=> a + (r.unidades||0)*(r.precioCliente||0), 0))
const totalCotizado = computed(()=> articulos.value.reduce((a,r)=> a + (r.unidades||0)*(r.precioSolicitado||0), 0))
const ahorro        = computed(()=> totalCliente.value - totalCotizado.value)
const ahorroPct     = computed(()=> totalCliente.value>0 ? (ahorro.value/totalCliente.value)*100 : 0)

const fechaDisplay = computed(() => {
  if (props.mode === 'edit' && props.initial?.fechaCreacion) {
    const raw = props.initial.fechaCreacion
    const d = raw?.toDate?.() || raw
    const parsed = new Date(d)
    if (!isNaN(parsed.getTime())) return parsed.toLocaleDateString('es-ES')
  }
  return new Date().toLocaleDateString('es-ES')
})
const numeroDisplay = computed(() =>
  props.mode === 'edit' ? (props.initial?.numero || '—') : 'Auto-generado'
)
const vendedorDisplay = computed(() =>
  props.mode === 'edit'
    ? (props.initial?.vendedor?.nombre || '—')
    : (user.nombre || '...')
)
const isSubmitting = computed(() => Boolean(props.loading || cotStore.saving))

function onCompradoAntesChange(row: Row, val: boolean | null) {
  if (!val) row.precioAnterior = null
}

function validarPrecioAnterior(a: Row, i: number) {
  if (!a.compradoAntes) return
  const p = a.precioAnterior
  if (p === null || p === undefined || String(p).trim() === '' || isNaN(Number(p)) || Number(p) < 0) {
    errores.value.push(`Artículo ${i + 1}: indica el precio anterior (obligatorio si ya se compró antes).`)
  }
}
const positive = (v:any)=> (v===null || v===undefined || Number(v) >= 0) || "Debe ser ≥ 0"

// ======= validación / submit =======
const snackbar = ref<{show:boolean; text:string; color:string}>({show:false,text:"",color:"success"})

function validar(): boolean {
  errores.value = []

  if (props.articulosOnly) {
    if (!articulos.value.length) errores.value.push("Debe añadir al menos un artículo.")
    articulos.value.forEach((a, i) => {
      validarArticuloIdentidad(a, i, errores.value)
      if (!a.unidades || a.unidades <= 0) errores.value.push(`Artículo ${i + 1}: unidades debe ser > 0.`)
      if (!isComprasArticlesView.value) validarPrecioAnterior(a, i)
      if (isComprasArticlesView.value && a.precioCoste != null && a.precioCoste !== undefined) {
        if (isNaN(Number(a.precioCoste)) || Number(a.precioCoste) < 0) {
          errores.value.push(`Artículo ${i + 1}: precio de coste debe ser ≥ 0.`)
        }
      }
    })
    return errores.value.length === 0
  }

  if (!cliente.value.trim()) errores.value.push("El campo Cliente es obligatorio.")
  if (!tarifa.value) errores.value.push("Debe seleccionar una tarifa.")
  if (!articulos.value.length) errores.value.push("Debe añadir al menos un artículo.")
  if (!formaPagoSolicitada.value.trim()) errores.value.push("La 'Forma de pago solicitada' es obligatoria.")
  if (!formaPagoActual.value.trim()) {
    errores.value.push("La 'Forma de pago actual' es obligatoria.")
  }

  articulos.value.forEach((a, i) => {
    validarArticuloIdentidad(a, i, errores.value)
    if (!a.unidades || a.unidades <= 0) errores.value.push(`Artículo ${i + 1}: unidades debe ser > 0.`)
    ;(['precioSolicitado','precioCompetencia'] as const).forEach((k) => {
      const v = a[k]
      if (v !== null && v !== undefined) {
        if (isNaN(Number(v)) || Number(v) < 0) {
          errores.value.push(`Artículo ${i + 1}: ${k==='precioSolicitado'?'precio solicitado':'precio competencia'} debe ser ≥ 0.`)
        }
      }
    })
    validarPrecioAnterior(a, i)
  })

  if (licitacion.value && !clienteFinal.value.trim()) {
    errores.value.push("Debe indicar el Cliente final en caso de licitación.")
  }

  if (stockEstado.value === 'parcial' && isRichTextEmpty(comentarioStock.value)) {
    errores.value.push('Describe qué artículos faltan o el detalle del stock parcial.')
  }
  if (stockEstado.value === 'sin_stock' && isRichTextEmpty(comentarioStock.value)) {
    errores.value.push('Indica qué artículos no hay en stock.')
  }

  if (!isTipoEntregaValid(tipoEntrega.value)) {
    errores.value.push('Debe indicar si la entrega es recogida o envío.')
  }

  if (errores.value.length) {
    console.warn('[FORM] validar -> errores:', errores.value)
  } else {
    console.log('[FORM] validar -> OK')
  }
  return errores.value.length === 0
}

function onPickFiles(payload: File | File[] | Event | null) {
  let list: File[] = []
  if (!payload) return
  if (payload instanceof Event) {
    list = Array.from((payload.target as HTMLInputElement).files || [])
  } else if (Array.isArray(payload)) {
    list = payload
  } else if (payload instanceof File) {
    list = [payload]
  }
  const claves = new Set(adjuntos.value.map(f => `${f.name}-${f.size}`))
  const nuevos: File[] = []
  for (const f of list) {
    if (f.size > MAX_ADJUNTO) {
      snackbar.value = { show: true, text: `"${f.name}" supera 10 MB.`, color: 'error' }
      continue
    }
    if (!claves.has(`${f.name}-${f.size}`)) nuevos.push(f)
  }
  if (nuevos.length) {
    adjuntos.value = [...adjuntos.value, ...nuevos]
    console.log('[FORM] onPickFiles -> añadidos:', nuevos.map(f => f.name), 'total:', adjuntos.value.length)
  }
}

watch(adjuntosPicker, (files) => {
  if (!files?.length) return
  onPickFiles(files)
  adjuntosPicker.value = []
})
function removeAdj(i: number) {
  console.log('[FORM] removeAdj ->', adjuntos.value[i]?.name)
  adjuntos.value.splice(i, 1)
}

function onSubmit() {
  if (isSubmitting.value) {
    console.warn('[FORM] onSubmit ignorado: guardado en curso')
    return
  }
  console.group('[FORM] onSubmit')
  console.log('mode:', props.mode, 'originalCount:', originalCount.value)
  if (!validar()) { console.groupEnd(); return }

  const legacyCompra = {
    compradoAntes: !!props.initial?.compradoAntes,
    precioAnterior: props.initial?.precioAnterior ?? null,
  }

  const sanitize = (a:any, idx = 0) => {
    const identidad = buildArticuloIdentidad({
      codigoProducto: a.codigoProducto,
      descripcionProducto: a.descripcionProducto,
    })
    const r:any = {
      codigoProducto: identidad.codigoProducto,
      descripcionProducto: identidad.descripcionProducto,
      articulo: identidad.articulo,
      url: (a.url||"").trim(),
      unidades: Number(a.unidades||0),
      precioCliente: Number(a.precioCliente||0),
    }
    if (!isComprasArticlesView.value) {
      if (a.precioSolicitado != null) r.precioSolicitado = Number(a.precioSolicitado)
      const compra = mapArticuloCompradoAntes(a, idx, legacyCompra)
      if (compra.compradoAntes) {
        r.compradoAntes = true
        r.precioAnterior = compra.precioAnterior != null ? Number(compra.precioAnterior) : Number(a.precioAnterior)
      } else {
        r.compradoAntes = false
      }
    }
    if (a.precioCompetencia != null) r.precioCompetencia = Number(a.precioCompetencia)
    if (isComprasArticlesView.value) {
      if (a.precioCoste != null && a.precioCoste !== '' && !isNaN(Number(a.precioCoste))) {
        r.precioCoste = Number(a.precioCoste)
      } else {
        r.precioCoste = null
      }
      const proveedor = String(a.proveedor || '').trim()
      r.proveedor = proveedor || null
    }
    return r
  }

  const originals: any[] = props.initial?.articulos || []
  let articulosFinal:any[] = []
  if (props.mode === 'edit') {
    if (props.unlockArticulos) {
      articulosFinal = articulos.value.map((a, i) =>
        mergeArticuloEdicion(originals[i], sanitize(a, i)),
      )
    } else {
      const originales = originals.map((a:any, i:number) =>
        mergeArticuloEdicion(a, sanitize(a, i)),
      )
      const nuevos = articulos.value.slice(originalCount.value).map((a, i) =>
        sanitize(a, originalCount.value + i),
      )
      articulosFinal = [...originales, ...nuevos]
    }
    console.log('[FORM] artículos -> total:', articulosFinal.length)
  } else {
    articulosFinal = articulos.value.map((a, i) => sanitize(a, i))
  }

  const data: any = props.articulosOnly
    ? { articulos: articulosFinal }
    : {
      cliente: cliente.value,
      tarifa: tarifa.value,
      articulos: articulosFinal,
      fechaDecision: (fechaDecision.value || null),
      stockEstado: stockEstado.value,
      stockDisponible: stockDisponibleLegacy(stockEstado.value),
      licitacion: licitacion.value,
      clienteFinal: clienteFinal.value,
      comentariosCliente: comentarios.value,
      formaPagoSolicitada: formaPagoSolicitada.value,
      formaPagoActual: formaPagoActual.value,
      condicionesEspeciales: condicionesEspeciales.value.trim(),
      plazoEntrega: plazoEntrega.value,
      lugarEntrega: lugarEntrega.value,
      tipoEntrega: tipoEntrega.value,
      comentarioStock: comentarioStock.value,
      ...(props.mode === "create"
        ? { createdAt: new Date(), updatedAt: new Date() }
        : { updatedAt: new Date() })
    }

  console.table(articulosFinal)
  console.log('[FORM] data listo (sin files):', { ...data, createdAt: !!data.createdAt, updatedAt: !!data.updatedAt })
  console.log('[FORM] adjuntos nuevos:', adjuntos.value.map(f=>f.name))

  emit('submit', { data, attachments: adjuntos.value })
  console.groupEnd()
}
</script>


<template>
  <v-row class="form-layout">
    <!-- Columna principal -->
    <v-col cols="12" :lg="articulosOnly ? 12 : 8" class="form-main">
      <v-card v-if="!articulosOnly" class="glass mb-6" elevation="8">
        <v-card-text>
          <div class="section-title">
            <Icon name="mdi:information-outline" class="text-primary" />
            <span>Datos básicos</span>
          </div>

          <v-row>
            <v-col cols="12" md="4">
              <v-text-field
                label="Fecha"
                :model-value="fechaDisplay"
                variant="outlined"
                density="comfortable"
                disabled
              >
                <template #prepend-inner>
                  <Icon name="mdi:calendar-month-outline" />
                </template>
              </v-text-field>
            </v-col>

            <v-col cols="12" md="4">
              <v-text-field
                label="Nº de Cotización"
                :model-value="numeroDisplay"
                placeholder="Auto-generado"
                variant="outlined"
                density="comfortable"
                disabled
              >
                <template #prepend-inner>
                  <Icon name="mdi:identifier" />
                </template>
              </v-text-field>
            </v-col>

            <v-col cols="12" md="4">
              <v-text-field
                label="Vendedor"
                :model-value="vendedorDisplay"
                variant="outlined"
                density="comfortable"
                disabled
              >
                <template #prepend-inner>
                  <Icon name="mdi:account-tie-outline" />
                </template>
              </v-text-field>
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12" md="5">
              <v-text-field
                v-model="cliente"
                :rules="[required]"
                label="Cliente"
                variant="outlined"
                density="comfortable"
                placeholder="Nombre o razón social"
              >
                <template #prepend-inner>
                  <Icon name="mdi:account-outline" />
                </template>
              </v-text-field>
            </v-col>

            <v-col cols="12" md="3">
              <v-select
                v-model="tarifa"
                :items="tarifas"
                :rules="[required]"
                label="Tarifa"
                variant="outlined"
                density="comfortable"
                placeholder="Selecciona"
              >
                <template #prepend-inner>
                  <Icon name="mdi:tag-outline" />
                </template>
              </v-select>
            </v-col>

            <v-col cols="12" md="4">
              <v-text-field
                v-model="condicionesEspeciales"
                label="Condiciones Especiales"
                variant="outlined"
                density="comfortable"
                hint="Ej.: Acuerdo de rappel, descuentos por pronto pago, etc…"
                persistent-hint
              >
                <template #prepend-inner>
                  <Icon name="mdi:handshake-outline" />
                </template>
              </v-text-field>
            </v-col>
          </v-row>
          <!-- Forma de pago solicitada (obligatoria) -->
          <v-row>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="formaPagoActual"
                label="Forma de pago actual"
                variant="outlined"
                density="comfortable"
                required
                :error="errores.some(e => e.includes('Forma de pago actual'))"
                hint="Ej.: Transferencia, Crédito 30 días…"
                persistent-hint
              >
                <template #prepend-inner>
                  <Icon name="mdi:credit-card-check-outline" />
                </template>
              </v-text-field>
            </v-col>

            <v-col cols="12" md="6">
              <v-text-field
                v-model="formaPagoSolicitada"
                label="Forma de pago solicitada"
                variant="outlined"
                density="comfortable"
                required
                :error="errores.some(e => e.includes('Forma de pago solicitada'))"
                hint="Ej.: Transferencia 30 días, Contado, Recibo 60 días…"
                persistent-hint
              >
                <template #prepend-inner>
                  <Icon name="mdi:credit-card-outline" />
                </template>
              </v-text-field>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

     <!-- Artículos -->
<v-card class="glass mb-6" elevation="8">
  <v-card-text>
    <div class="section-title">
      <Icon name="mdi:cube-outline" class="text-primary" />
      <span>Artículos</span>
    </div>

    <div class="table-wrap">
      <table class="modern-table">
        <thead>
          <tr>
            <th style="min-width:140px">Código producto</th>
            <th style="min-width:220px">Descripción producto</th>
            <th class="text-center" style="width:74px">URL</th>
            <th class="num-units">Unid.</th>
            <th class="num" style="width:150px">Precio Tarifa (€)</th>
            <th v-if="!isComprasArticlesView" class="num" style="width:150px">
              <div class="d-flex align-center ga-1">
                <span>Solicitado (€)</span>
                <v-tooltip :key="'th-sol'">
                  <template #activator="{ props: tipS }">
                    <span v-bind="tipS" class="cursor-pointer">
                      <Icon name="mdi:information-outline" />
                    </span>
                  </template>
                  <template #default>Precio propuesto por el cliente. (Opcional)</template>
                </v-tooltip>
              </div>
            </th>

            <!-- Competencia -->
            <th class="num" style="width:150px">
              <div class="d-flex align-center ga-1">
                <span>Competencia (€)</span>
                <v-tooltip :key="'th-comp'" >
                  <template #activator="{ props: tipC }">
                    <span v-bind="tipC" class="cursor-pointer">
                      <Icon name="mdi:information-outline" />
                    </span>
                  </template>
                   <template #default>Precio observado en competidor. (Opcional)</template>
                </v-tooltip>
              </div>
            </th>
            <th v-if="isComprasArticlesView" class="num" style="width:150px">
              <div class="d-flex align-center ga-1">
                <span>Precio coste (€)</span>
                <v-tooltip>
                  <template #activator="{ props: tipCoste }">
                    <span v-bind="tipCoste" class="cursor-pointer">
                      <Icon name="mdi:information-outline" />
                    </span>
                  </template>
                  <template #default>Precio de coste de compra para esta línea.</template>
                </v-tooltip>
              </div>
            </th>
            <th v-if="isComprasArticlesView" style="min-width:160px">
              <div class="d-flex align-center ga-1">
                <span>Proveedor</span>
                <v-tooltip>
                  <template #activator="{ props: tipProv }">
                    <span v-bind="tipProv" class="cursor-pointer">
                      <Icon name="mdi:information-outline" />
                    </span>
                  </template>
                  <template #default>Proveedor de compra para esta línea.</template>
                </v-tooltip>
              </div>
            </th>
            <th v-if="!isComprasArticlesView" class="num line-compra-ant" style="width:150px">
              <div class="d-flex align-center ga-1">
                <span>Compra ant.</span>
                <v-tooltip>
                  <template #activator="{ props: tipA }">
                    <span v-bind="tipA" class="cursor-pointer">
                      <Icon name="mdi:information-outline" />
                    </span>
                  </template>
                  <template #default>Si el cliente ya compró este artículo antes, indica el precio anterior.</template>
                </v-tooltip>
              </div>
            </th>
            <th class="num" style="width:130px">Total</th>
            <th style="width:56px"></th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="(row, i) in articulos" :key="i" :class="{ 'row-locked': isLocked(i) }">
            <!-- Código + descripción -->
            <td>
              <div class="d-flex align-center ga-2">
                <Icon v-if="isLocked(i)" name="mdi:lock-outline" class="lock-icon" title="Artículo original bloqueado" />
                <v-text-field
                  v-model="row.codigoProducto"
                  variant="outlined" density="compact" hide-details
                  placeholder="Código"
                  :disabled="isLocked(i)"
                  style="min-width:120px"
                  required
                >
                  <template #prepend-inner><Icon name="mdi:barcode" /></template>
                </v-text-field>
              </div>
            </td>
            <td>
              <v-text-field
                v-model="row.descripcionProducto"
                variant="outlined" density="compact" hide-details
                placeholder="Descripción del producto"
                :disabled="isLocked(i)"
                class="flex-grow-1"
                required
              >
                <template #prepend-inner><Icon name="mdi:text-box-outline" /></template>
              </v-text-field>
            </td>

            <!-- URL como botón + modal -->
            <td class="text-center">
              <v-btn size="small" variant="tonal" @click="openUrlDialog(i)" :disabled="isLocked(i)">
                <template #prepend><Icon name="mdi:link-variant"/></template>
                {{ row.url ? 'Editar' : 'Añadir' }}
              </v-btn>
            </td>

            <!-- Unidades estrecho -->
            <td class="num-units">
              <v-text-field
                v-model.number="row.unidades" :rules="[positive]"
                type="number" min="0"
                variant="outlined" density="compact" hide-details
                class="units-input"
                :disabled="isLocked(i)"
              />
            </td>

            <!-- Precio tarifa estrecho -->
            <td class="num">
              <v-text-field
                v-model.number="row.precioCliente" :rules="[positive]"
                type="number" min="0"
                variant="outlined" density="compact" hide-details
                style="max-width:150px"
                :disabled="isLocked(i)"
              >
                <template #prepend-inner><Icon name="mdi:currency-eur" /></template>
              </v-text-field>
            </td>

            <!-- Solicitado (solo comerciales / supervisora) -->
    <td v-if="!isComprasArticlesView" class="num">
      <div class="d-flex align-center ga-1">
        <v-text-field
          v-if="row.mostrarSolicitado"
          v-model.number="row.precioSolicitado" :rules="[positive]"
          type="number" min="0" variant="outlined" density="compact" hide-details
          :disabled="isLocked(i)"
          style="max-width:140px" placeholder="Solicitado">
          <template #prepend-inner><Icon name="mdi:currency-eur" /></template>
        </v-text-field>

        <v-tooltip v-else :key="'tfield-sol'" text="Añadir precio solicitado">
          <template #activator="{ props: tipS }">
            <span v-bind="tipS">
              <v-btn icon variant="text" @click="row.mostrarSolicitado = true" :disabled="isLocked(i)">
                <Icon name="mdi:plus" />
              </v-btn>
            </span>
          </template>
        </v-tooltip>
      </div>
    </td>

    <!-- Competencia -->
    <td class="num">
      <div class="d-flex align-center ga-1">
        <v-text-field
          v-if="row.mostrarCompetencia"
          v-model.number="row.precioCompetencia" :rules="[positive]"
          type="number" min="0" variant="outlined" density="compact" hide-details
          style="max-width:140px" placeholder="Compet."
          :disabled="isLocked(i)">
          <template #prepend-inner><Icon name="mdi:sword-cross" /></template>
        </v-text-field>

        <v-tooltip v-else :key="'tfield-comp'" text="Añadir precio de la competencia">
          <template #activator="{ props: tipC }">
            <span v-bind="tipC">
              <v-btn icon variant="text" :disabled="isLocked(i)" @click="row.mostrarCompetencia = true">
                <Icon name="mdi:plus" />
              </v-btn>
            </span>
          </template>
        </v-tooltip>
      </div>
    </td>

    <!-- Precio coste (solo Compras) -->
    <td v-if="isComprasArticlesView" class="num">
      <v-text-field
        v-model.number="row.precioCoste"
        :rules="[positive]"
        type="number"
        min="0"
        step="0.01"
        variant="outlined"
        density="compact"
        hide-details
        style="max-width:150px"
        placeholder="Coste"
        :disabled="isLocked(i)"
      >
        <template #prepend-inner><Icon name="mdi:tag-outline" /></template>
      </v-text-field>
    </td>

    <!-- Proveedor (solo Compras) -->
    <td v-if="isComprasArticlesView">
      <v-text-field
        v-model="row.proveedor"
        variant="outlined"
        density="compact"
        hide-details
        style="min-width:150px"
        placeholder="Proveedor"
        :disabled="isLocked(i)"
      >
        <template #prepend-inner><Icon name="mdi:truck-delivery-outline" /></template>
      </v-text-field>
    </td>

    <!-- Compra anterior (solo comerciales / supervisora) -->
    <td v-if="!isComprasArticlesView" class="num line-compra-ant">
      <div class="line-compra-ant__cell">
        <v-switch
          v-model="row.compradoAntes"
          density="compact"
          hide-details
          color="primary"
          :disabled="isLocked(i)"
          @update:model-value="(v) => onCompradoAntesChange(row, v)"
        />
        <v-text-field
          v-if="row.compradoAntes"
          v-model.number="row.precioAnterior"
          type="number"
          min="0"
          density="compact"
          variant="outlined"
          hide-details
          placeholder="Precio ant."
          style="max-width:130px"
          :disabled="isLocked(i)"
        >
          <template #prepend-inner><Icon name="mdi:history" /></template>
        </v-text-field>
      </div>
    </td>

            <!-- Total -->
            <td class="num total-cell">
              {{ ((Number(row.unidades)||0) * (Number(row.precioCliente)||0)).toFixed(2) }} €
            </td>

            <!-- Eliminar -->
            <td class="actions">
              <v-btn icon :disabled="isLocked(i)" variant="text" @click="removeArticulo(i)">
                <Icon name="mdi:trash-can-outline" />
              </v-btn>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <v-btn class="mt-3" color="primary" variant="elevated" @click="addArticulo">
      <Icon name="mdi:plus" class="me-2" /> Añadir artículo
    </v-btn>

    <v-alert v-if="articulosOnly && errores.length" type="error" variant="tonal" class="mt-4">
      <ul class="mb-0 ps-4">
        <li v-for="(e, i) in errores" :key="i">{{ e }}</li>
      </ul>
    </v-alert>

    <div v-if="articulosOnly" class="form-actions mt-6 d-flex flex-wrap align-center ga-3">
      <v-btn :loading="isSubmitting" :disabled="isSubmitting" color="primary" size="large" @click="onSubmit">
        <Icon name="mdi:content-save-outline" class="me-2" />
        Guardar artículos
      </v-btn>
      <v-btn
        v-if="detailUrl"
        variant="text"
        :disabled="isSubmitting"
        @click="navigateTo(detailUrl)"
      >
        Cancelar
      </v-btn>
    </div>
  </v-card-text>
</v-card>

<!-- Modal URL -->
<v-dialog v-model="urlDialog" max-width="520">
  <v-card>
    <v-card-title class="text-h6">Enlace del artículo</v-card-title>
    <v-card-text>
      <v-text-field v-model="urlDraft" type="url" label="URL" placeholder="https://..." variant="outlined" />
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn variant="text" @click="urlDialog=false">Cancelar</v-btn>
      <v-btn color="primary" @click="saveUrl">Guardar</v-btn>
    </v-card-actions>
  </v-card>
</v-dialog>

<!-- Adjuntos -->
<v-card v-if="!articulosOnly" class="glass mb-6" elevation="8">
  <v-card-text>
    <div class="section-title">
      <Icon name="mdi:paperclip" class="text-primary" />
      <span>Adjuntos (presupuestos, PDFs, imágenes…)</span>
    </div>

    <!-- Adjuntos existentes (solo en editar) -->
    <div v-if="props.mode === 'edit'">
      <div class="text-medium-emphasis mb-2">Archivos ya adjuntados anteriormente:</div>

      <div v-if="adjuntosDB.length" class="d-flex ga-2 flex-wrap">
        <v-chip
          v-for="a in adjuntosDB"
          :key="a.id"
          variant="elevated"
          color="grey-lighten-3"
          class="d-flex align-center"
        >
          <Icon name="mdi:file" class="mr-1" />
          <a :href="a.url" target="_blank" rel="noopener" class="mr-2 text-primary">
            {{ a.nombre }}
          </a>
        </v-chip>
      </div>

      <v-alert
        v-else
        variant="tonal"
        type="info"
        class="mb-3"
      >
        Esta cotización no tiene adjuntos todavía.
      </v-alert>

      <v-divider class="my-4" />
    </div>

    <!-- Añadir nuevos adjuntos -->
    <div class="d-flex ga-3 flex-wrap align-center">
      <v-file-input
        v-model="adjuntosPicker"
        label="Añadir archivos"
        variant="outlined"
        density="comfortable"
        multiple
        show-size
        accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv"
        prepend-icon=""
        style="max-width: 420px"
      >
        <template #prepend-inner>
          <Icon name="mdi:paperclip" />
        </template>
      </v-file-input>

      <small class="text-medium-emphasis">
        Máx. 10 MB por archivo. Se subirán al enviar el formulario.
      </small>
    </div>

    <!-- Lista de nuevos adjuntos (por subir) -->
    <div v-if="adjuntos.length" class="mt-3 d-flex ga-2 flex-wrap">
      <v-chip
        v-for="(f, i) in adjuntos"
        :key="`${f.name}-${f.size}-${i}`"
        variant="elevated"
        class="d-flex align-center"
      >
        <Icon name="mdi:file" class="mr-1" />
        {{ f.name }} — {{ (f.size/1024/1024).toFixed(2) }} MB
        <v-btn
          icon
          size="x-small"
          variant="text"
          class="ml-1"
          :title="`Quitar ${f.name}`"
          @click="removeAdj(i)"
        >
          <Icon name="mdi:close" />
        </v-btn>
      </v-chip>
    </div>
  </v-card-text>
</v-card>

      <!-- Información adicional -->
      <v-card v-if="!articulosOnly" class="glass extra-info-card" elevation="8">
        <v-card-text>
          <div class="section-title">
            <Icon name="mdi:clipboard-list-outline" class="text-primary" />
            <span>Información adicional</span>
          </div>

          <p class="section-lead">
            Completa los datos logísticos y comerciales que ayuden al supervisor a cotizar con precisión.
          </p>

          <div class="subsection-label">Disponibilidad de stock</div>
          <div class="stock-grid mb-4">
            <button
              v-for="opt in stockOpciones"
              :key="opt.value"
              type="button"
              class="stock-option"
              :class="{
                'stock-option--active': stockEstado === opt.value,
                [`stock-option--${opt.value}`]: true,
              }"
              @click="stockEstado = opt.value"
            >
              <Icon
                :name="opt.value === 'con_stock' ? 'mdi:check-circle-outline' : opt.value === 'parcial' ? 'mdi:alert-circle-outline' : 'mdi:cart-off'"
                class="stock-option__icon"
              />
              <span class="stock-option__label">{{ opt.label }}</span>
              <span class="stock-option__hint">{{ opt.hint }}</span>
            </button>
          </div>

          <div class="subsection-label">Opciones</div>
          <div class="toggle-grid mb-2">
            <div class="toggle-card" :class="{ 'toggle-card--active': licitacion }">
              <v-switch
                v-model="licitacion"
                color="primary"
                hide-details
                density="compact"
                class="toggle-card__switch"
              />
              <div>
                <div class="toggle-card__title">Es licitación</div>
                <div class="toggle-card__hint">Actívalo si la cotización forma parte de un concurso</div>
              </div>
            </div>
          </div>

          <v-expand-transition>
            <div v-if="licitacion" class="mt-3 mb-1">
              <v-text-field
                v-model="clienteFinal"
                :rules="[required]"
                label="Cliente final"
                hint="Obligatorio cuando es licitación"
                persistent-hint
                variant="outlined"
                density="comfortable"
              >
                <template #prepend-inner><Icon name="mdi:account-group-outline" /></template>
              </v-text-field>
            </div>
          </v-expand-transition>

          <v-divider class="my-5" />

          <div class="subsection-label">Stock y artículos</div>
          <div class="callout callout--info mb-4">
            <Icon name="mdi:information-outline" class="callout__icon" />
            <p class="callout__text">
              Antes de confirmar, comprueba que haya unidades de todo. Si es parcial, comunícalo;
              si es un equipo y falta algún componente, indícalo también.
            </p>
          </div>

          <div class="mb-4 rich-field">
            <label class="rich-field__label">
              {{ stockEstado === 'parcial' ? 'Detalle del stock parcial (obligatorio)' : stockEstado === 'sin_stock' ? 'Qué artículos faltan (obligatorio)' : 'Comentario sobre artículos' }}
            </label>
            <RichTextEditor
              v-model="comentarioStock"
              placeholder="Pega aquí tablas o texto del correo (negritas, colores, celdas…)"
              :min-height="300"
            />
            <p class="rich-field__hint">Editor enriquecido: puedes pegar tablas del correo y dar formato (negrita, color, fondo de celda).</p>
          </div>

          <v-divider class="my-5" />

          <div class="subsection-label">Entrega y plazos</div>
          <div class="subsection-hint mb-3">Indica si el cliente recoge o hay que enviar el pedido.</div>
          <div class="stock-grid entrega-grid mb-4">
            <button
              v-for="opt in tipoEntregaOpciones"
              :key="opt.value"
              type="button"
              class="stock-option entrega-option"
              :class="{
                'stock-option--active': tipoEntrega === opt.value,
                [`entrega-option--${opt.value}`]: true,
              }"
              @click="tipoEntrega = opt.value"
            >
              <Icon
                :name="opt.value === 'recogida' ? 'mdi:store-outline' : 'mdi:truck-delivery-outline'"
                class="stock-option__icon"
              />
              <span class="stock-option__label">{{ opt.label }}</span>
              <span class="stock-option__hint">{{ opt.hint }}</span>
            </button>
          </div>
          <v-row>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="fechaDecision"
                label="Fecha de decisión"
                type="date"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="plazoEntrega"
                label="Plazo de entrega"
                variant="outlined"
                density="comfortable"
                placeholder="Ej.: 7 días, inmediato..."
              >
                <template #prepend-inner><Icon name="mdi:truck-delivery-outline" /></template>
              </v-text-field>
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="lugarEntrega"
                :label="tipoEntrega === 'envio' ? 'Dirección de envío' : tipoEntrega === 'recogida' ? 'Lugar de recogida' : 'Lugar de entrega'"
                variant="outlined"
                density="comfortable"
                placeholder="Oficina, obra, almacén..."
              >
                <template #prepend-inner><Icon name="mdi:map-marker-outline" /></template>
              </v-text-field>
            </v-col>
          </v-row>

          <v-divider class="my-5" />

          <div class="subsection-label">Comentarios del cliente</div>
          <div class="rich-field">
            <label class="rich-field__label">Observaciones o peticiones del cliente</label>
            <RichTextEditor
              v-model="comentarios"
              placeholder="Pega aquí el correo del cliente con tablas, listas o formato"
              :min-height="260"
            />
            <p class="rich-field__hint">El formato se conserva al guardar y en la vista de detalle.</p>
          </div>

          <v-alert
            v-if="errores.length"
            type="error"
            variant="tonal"
            class="my-4"
          >
            <ul class="mb-0 ps-4">
              <li v-for="(e, i) in errores" :key="i">{{ e }}</li>
            </ul>
          </v-alert>

          <div class="form-actions mt-6 d-flex flex-wrap align-center ga-3">
            <v-btn :loading="isSubmitting" :disabled="isSubmitting" color="primary" size="large" @click="onSubmit">
              <Icon name="mdi:send-outline" class="me-2" />
              {{ props.mode === 'edit' ? 'Guardar cambios' : 'Enviar solicitud' }}
            </v-btn>
            <v-btn
              v-if="props.mode === 'edit' && detailUrl"
              variant="text"
              :disabled="isSubmitting"
              @click="navigateTo(detailUrl)"
            >
              Cancelar
            </v-btn>
          </div>

            <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="bottom right">
                {{ snackbar.text }}
            </v-snackbar>
        </v-card-text>
      </v-card>
    </v-col>

    <!-- Columna resumen -->
    <v-col v-if="!articulosOnly" cols="12" lg="4" class="form-sidebar">
      <v-card class="glass summary-card sticky" elevation="10">
        <v-card-text>
          <div class="summary-header">
            <Icon name="mdi:chart-donut" class="text-primary" />
            <span>Resumen</span>
          </div>

          <div class="summary-metric">
            <span class="summary-label">Total tarifa</span>
            <strong class="summary-value">€ {{ totalCliente.toFixed(2) }}</strong>
          </div>
          <div class="summary-metric">
            <span class="summary-label">Total solicitado</span>
            <strong class="summary-value">€ {{ totalCotizado.toFixed(2) }}</strong>
          </div>
          <v-divider class="my-3" />
          <div class="summary-metric summary-accent" :class="{ good: ahorro >= 0, bad: ahorro < 0 }">
            <span class="summary-label">Ahorro estimado</span>
            <strong class="summary-value">
              € {{ ahorro.toFixed(2) }}
              <span class="summary-pct">({{ ahorroPct.toFixed(1) }}%)</span>
            </strong>
          </div>

          <v-alert
            v-if="avisaCompras"
            type="warning"
            variant="tonal"
            class="mt-4"
            density="comfortable"
            :title="stockEstado === 'sin_stock' ? 'Sin stock' : 'Stock parcial'"
            text="Se notificará automáticamente a Compras cuando se envíe."
          />
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>

<style scoped lang="css">
.form-layout{ margin: 0 }
.form-main, .form-sidebar{ padding-top: 0; padding-bottom: 0 }
.section-lead{
  color:#64748b;
  font-size:.94rem;
  line-height:1.5;
  margin:-.25rem 0 1.25rem;
}
.subsection-label{
  font-size:.72rem;
  font-weight:700;
  letter-spacing:.08em;
  text-transform:uppercase;
  color:#94a3b8;
  margin-bottom:.75rem;
}
.toggle-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));
  gap:12px;
}
.stock-grid{
  display:grid;
  grid-template-columns:repeat(3, minmax(0, 1fr));
  gap:10px;
}
.stock-option{
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  gap:4px;
  padding:14px;
  border-radius:14px;
  border:1px solid rgba(15, 23, 42, 0.08);
  background:#fff;
  cursor:pointer;
  text-align:left;
  transition:border-color .15s ease, box-shadow .15s ease, background .15s ease;
}
.stock-option:hover{
  border-color:rgba(25, 118, 210, 0.25);
}
.stock-option--active{
  box-shadow:0 0 0 2px rgba(25, 118, 210, 0.18);
}
.stock-option--active.stock-option--con_stock{
  border-color:#16a34a;
  background:#f0fdf4;
}
.stock-option--active.stock-option--parcial{
  border-color:#d97706;
  background:#fffbeb;
}
.stock-option--active.stock-option--sin_stock{
  border-color:#dc2626;
  background:#fef2f2;
}
.stock-option__icon{
  font-size:1.25rem;
  color:#64748b;
}
.stock-option--active.stock-option--con_stock .stock-option__icon{ color:#16a34a; }
.stock-option--active.stock-option--parcial .stock-option__icon{ color:#d97706; }
.stock-option--active.stock-option--sin_stock .stock-option__icon{ color:#dc2626; }
.stock-option__label{
  font-size:.92rem;
  font-weight:700;
  color:#0f172a;
}
.stock-option__hint{
  font-size:.78rem;
  line-height:1.35;
  color:#64748b;
}
.entrega-grid{
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.entrega-option--active.entrega-option--recogida{
  border-color:#0d9488;
  background:#f0fdfa;
}
.entrega-option--active.entrega-option--envio{
  border-color:#2563eb;
  background:#eff6ff;
}
.entrega-option--active.entrega-option--recogida .stock-option__icon{ color:#0d9488; }
.entrega-option--active.entrega-option--envio .stock-option__icon{ color:#2563eb; }
.subsection-hint{
  font-size: 0.82rem;
  color: rgba(0, 0, 0, 0.55);
}
@media (max-width: 768px){
  .stock-grid{ grid-template-columns:1fr; }
  .entrega-grid{ grid-template-columns:1fr; }
}
.toggle-card{
  display:flex;
  align-items:flex-start;
  gap:10px;
  padding:14px 14px 14px 10px;
  border-radius:14px;
  border:1px solid rgba(15, 23, 42, 0.08);
  background:#fff;
  transition:border-color .2s ease, box-shadow .2s ease, background .2s ease;
}
.toggle-card--active{
  border-color:rgba(25, 118, 210, 0.28);
  background:rgba(25, 118, 210, 0.04);
  box-shadow:0 4px 14px rgba(25, 118, 210, 0.07);
}
.toggle-card__switch{
  flex-shrink:0;
  margin-top:-2px;
}
.toggle-card__title{
  font-weight:600;
  font-size:.9rem;
  color:#0f172a;
  line-height:1.3;
}
.toggle-card__hint{
  font-size:.78rem;
  color:#64748b;
  line-height:1.4;
  margin-top:3px;
}
.extra-info-card :deep(.v-divider){
  opacity:.55;
}
.callout{
  display:flex;
  align-items:flex-start;
  gap:12px;
  padding:14px 16px;
  border-radius:14px;
}
.callout--info{
  background:rgba(239, 246, 255, 0.85);
  border:1px solid rgba(59, 130, 246, 0.18);
  box-shadow:inset 3px 0 0 #3b82f6;
}
.callout--warning{
  background:linear-gradient(135deg, #fffdf7 0%, #fff8e8 100%);
  border:1px solid rgba(251, 191, 36, 0.28);
  box-shadow:inset 3px 0 0 #f59e0b;
}
.callout__icon{
  color:#2563eb;
  font-size:1.15rem;
  flex-shrink:0;
  margin-top:2px;
}
.callout--warning .callout__icon{ color:#d97706 }
.callout__text{
  margin:0;
  color:#334155;
  font-size:.92rem;
  line-height:1.55;
}
.lock-icon{
  flex-shrink: 0;
  color: #94a3b8;
  font-size: 1rem;
}
.glass{
  border-radius: 18px;
  backdrop-filter: blur(6px);
  background: rgba(255,255,255,0.85) !important;
  border: 1px solid rgba(25,118,210,0.08);
}
.section-title{
  display:flex; align-items:center; gap:.5rem;
  font-weight:600; margin-bottom: .75rem;
}
.table-wrap{ overflow-x:auto }
.modern-table{
  width:100%;
  border-collapse: separate;
  border-spacing: 0 10px;
}
.modern-table thead th{
  font-weight:600; color:#334155; text-align:left; padding:8px 10px;
}
.modern-table tbody tr{
  background:#fff;
  box-shadow: 0 8px 20px rgba(15, 23, 42, .06);
}
.modern-table tbody tr.row-locked{
  background:#f8fafc;
}
.modern-table tbody tr.row-locked td:first-child{
  border-left: 3px solid #cbd5e1;
}
.modern-table td{
  padding:8px 10px; vertical-align:middle;
}
.modern-table .num{ min-width:140px; text-align:right }
.modern-table .num-units{
  width:88px;
  min-width:88px;
  max-width:88px;
  text-align:center;
  padding-left:8px;
  padding-right:8px;
}
.modern-table .num-units .units-input{
  max-width:72px;
  margin-inline:auto;
}
.modern-table .num-units :deep(input[type="number"]){
  text-align:center;
}
.line-compra-ant__cell{
  display:flex;
  flex-direction:column;
  align-items:flex-end;
  gap:6px;
  min-width:130px;
}
.line-compra-ant__cell :deep(.v-switch){
  flex:none;
}
.total-cell{ font-weight:600; color:#0f172a }
.actions{ width:56px; text-align:center }
.sticky{
  position: sticky; top: 24px;
}
.summary-card{
  border-radius: 18px;
}
.summary-header{
  display:flex;
  align-items:center;
  gap:.5rem;
  font-weight:700;
  font-size:1.05rem;
  margin-bottom:1rem;
  color:#0f172a;
}
.summary-metric{
  display:flex;
  justify-content:space-between;
  align-items:baseline;
  gap:1rem;
  padding:.55rem 0;
}
.summary-label{
  color:#64748b;
  font-size:.92rem;
}
.summary-value{
  color:#0f172a;
  font-size:1.02rem;
  text-align:right;
}
.summary-accent .summary-value{
  font-size:1.08rem;
}
.summary-pct{
  font-size:.88rem;
  font-weight:600;
}
.summary-accent.good .summary-value{ color:#16a34a }
.summary-accent.bad .summary-value{ color:#dc2626 }
.form-actions{
  padding-top:.5rem;
  border-top:1px solid rgba(15, 23, 42, .08);
}
.summary-row{
  display:flex; justify-content:space-between; padding:.4rem 0;
  font-size: .98rem;
}
.summary-row.accent strong{ font-size:1.05rem }
.summary-row.good strong{ color:#16a34a }
.summary-row.bad  strong{ color:#dc2626 }
.textarea-formatted :deep(textarea) {
  font-family: inherit;
  line-height: 1.5;
  white-space: pre-wrap;
}
.rich-field__label {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.6);
}
.rich-field__hint {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  color: rgba(0, 0, 0, 0.55);
}
</style>

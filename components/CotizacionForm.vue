<script setup lang="ts">
import { useCotizacionesStore } from "~/stores/cotizaciones"
import { useUserStore } from "~/stores/user"
import { getDocs, collection, deleteDoc, doc } from "firebase/firestore"
import { ref as storageRef, deleteObject } from "firebase/storage"

type Row = {
  articulo: string
  url: string
  unidades: number
  precioCliente: number
  precioSolicitado?: number
  precioCompetencia?: number
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

const props = defineProps<{ mode?: 'create' | 'edit', initial?: any }>()
const emit = defineEmits<{ (e:'submit', payload:any): void }>()

const { $db, $storage, $auth } = useNuxtApp()
const cotStore = useCotizacionesStore()
const user = useUserStore()

async function ensureAuth() {
  if ($auth.currentUser) return
  const { signInAnonymously } = await import('firebase/auth')
  await signInAnonymously($auth)
}

const cliente = ref("")
const tarifa  = ref<string | null>(null)
const tarifas = ["A1","A2","A3","A4","A5","A6","A7"]
const fechaDecision = ref<string | null>(null)

const articulos = ref<Row[]>([
  { articulo:"", url:"", unidades:1, precioCliente:0, precioSolicitado:undefined, precioCompetencia:undefined, mostrarSolicitado:false, mostrarCompetencia:false }
])

const originalCount = ref(0)
const isLocked = (i:number) => props.mode === 'edit' && i < originalCount.value

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
const adjuntosDB = ref<AdjuntoDB[]>([])

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

    const base = (props.initial.articulos?.length
      ? props.initial.articulos
      : [{ articulo:"", url:"", unidades:0, precioCliente:0 }])
      .map((a:any)=>({
        articulo: a.articulo || "",
        url: a.url || "",
        unidades: Number(a.unidades)||1,
        precioCliente: Number(a.precioCliente)||0,
        precioSolicitado: a.precioSolicitado!=null ? Number(a.precioSolicitado) : undefined,
        precioCompetencia: a.precioCompetencia!=null ? Number(a.precioCompetencia) : undefined,
        mostrarSolicitado: a.precioSolicitado != null,
        mostrarCompetencia: a.precioCompetencia != null,
      }))
    articulos.value = base
    originalCount.value = base.length
    console.log('originalCount:', originalCount.value)

    // resto de campos
    stockDisponible.value = props.initial.stockDisponible ?? true
    licitacion.value      = !!props.initial.licitacion
    clienteFinal.value    = props.initial.clienteFinal || ""
    comentarios.value     = props.initial.comentariosCliente || ""
    formaPagoSolicitada.value = props.initial?.formaPagoSolicitada || ""
    plazoEntrega.value    = props.initial?.plazoEntrega || ""
    lugarEntrega.value    = props.initial?.lugarEntrega || ""
    comentarioStock.value = props.initial?.comentarioStock || ""
    compradoAntes.value   = !!props.initial.compradoAntes
    precioAnterior.value  = props.initial.precioAnterior || null
    precioCompet.value    = props.initial.precioCompet || null
    fechaDecision.value   = props.initial.fechaDecision || null

    await cargarAdjuntosDB()
  }
  console.groupEnd()
})

// ======= acciones artículos =======
function addArticulo() {
  articulos.value.push({
    articulo: "", url: "", unidades: 1, precioCliente: 0,
    precioSolicitado: undefined, precioCompetencia: undefined,
    mostrarSolicitado: false, mostrarCompetencia: false
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
const stockDisponible = ref(true)
const compradoAntes   = ref(false)
const precioAnterior  = ref<number | null>(null)
const licitacion      = ref(false)
const clienteFinal    = ref("")
const precioCompet    = ref<number | null>(null)
const comentarios     = ref("")
const formaPagoSolicitada = ref("")
const plazoEntrega  = ref("")
const lugarEntrega  = ref("")
const comentarioStock = ref("")

// ======= totales =======
const totalCliente  = computed(()=> articulos.value.reduce((a,r)=> a + (r.unidades||0)*(r.precioCliente||0), 0))
const totalCotizado = computed(()=> articulos.value.reduce((a,r)=> a + (r.unidades||0)*(r.precioSolicitado||0), 0))
const ahorro        = computed(()=> totalCliente.value - totalCotizado.value)
const ahorroPct     = computed(()=> totalCliente.value>0 ? (ahorro.value/totalCliente.value)*100 : 0)

// ======= reglas =======
const required = (v:any)=> (!!v || v===0) || "Obligatorio"
const positive = (v:any)=> (v===null || v===undefined || Number(v) >= 0) || "Debe ser ≥ 0"

// ======= validación / submit =======
const snackbar = ref<{show:boolean; text:string; color:string}>({show:false,text:"",color:"success"})

function validar(): boolean {
  errores.value = []
  if (!cliente.value.trim()) errores.value.push("El campo Cliente es obligatorio.")
  if (!tarifa.value) errores.value.push("Debe seleccionar una tarifa.")
  if (!articulos.value.length) errores.value.push("Debe añadir al menos un artículo.")
  if (!formaPagoSolicitada.value.trim()) errores.value.push("La 'Forma de pago solicitada' es obligatoria.")

  articulos.value.forEach((a, i) => {
    if (!a.articulo || !String(a.articulo).trim()) errores.value.push(`Artículo ${i + 1}: falta el nombre.`)
    if (!a.unidades || a.unidades <= 0) errores.value.push(`Artículo ${i + 1}: unidades debe ser > 0.`)
    ;(['precioSolicitado','precioCompetencia'] as const).forEach((k) => {
      const v = a[k]
      if (v !== null && v !== undefined) {
        if (isNaN(Number(v)) || Number(v) < 0) {
          errores.value.push(`Artículo ${i + 1}: ${k==='precioSolicitado'?'precio solicitado':'precio competencia'} debe ser ≥ 0.`)
        }
      }
    })
  })

  if (licitacion.value && !clienteFinal.value.trim()) {
    errores.value.push("Debe indicar el Cliente final en caso de licitación.")
  }

  if (errores.value.length) {
    console.warn('[FORM] validar -> errores:', errores.value)
  } else {
    console.log('[FORM] validar -> OK')
  }
  return errores.value.length === 0
}

function onPickFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const list = Array.from(input.files || [])
  const claves = new Set(adjuntos.value.map(f => `${f.name}-${f.size}`))
  const nuevos = list.filter(f => !claves.has(`${f.name}-${f.size}`))
  adjuntos.value = [...adjuntos.value, ...nuevos]
  input.value = ""
  console.log('[FORM] onPickFiles -> añadidos:', nuevos.map(f=>f.name), 'total:', adjuntos.value.length)
}
function removeAdj(i: number) {
  console.log('[FORM] removeAdj ->', adjuntos.value[i]?.name)
  adjuntos.value.splice(i, 1)
}

function onSubmit() {
  console.group('[FORM] onSubmit')
  console.log('mode:', props.mode, 'originalCount:', originalCount.value)
  if (!validar()) { console.groupEnd(); return }

  const sanitize = (a:any) => {
    const r:any = {
      articulo: (a.articulo||"").trim(),
      url: (a.url||"").trim(),
      unidades: Number(a.unidades||0),
      precioCliente: Number(a.precioCliente||0),
    }
    if (a.precioSolicitado != null)    r.precioSolicitado = Number(a.precioSolicitado)
    if (a.precioCompetencia != null) r.precioCompetencia = Number(a.precioCompetencia)
    return r
  }

  let articulosFinal:any[] = []
  if (props.mode === 'edit') {
    const originales = (props.initial?.articulos || []).map(sanitize)
    const nuevos = articulos.value.slice(originalCount.value).map(sanitize)
    articulosFinal = [...originales, ...nuevos]
    console.log('[FORM] artículos -> originales:', originales.length, 'nuevos:', nuevos.length, 'total:', articulosFinal.length)
  } else {
    articulosFinal = articulos.value.map(sanitize)
  }

  const data: any = {
    cliente: cliente.value,
    tarifa: tarifa.value,
    articulos: articulosFinal,
    compradoAntes: compradoAntes.value,
    precioAnterior: (precioAnterior.value ?? null),
    fechaDecision: (fechaDecision.value || null),
    stockDisponible: stockDisponible.value,
    licitacion: licitacion.value,
    clienteFinal: clienteFinal.value,
    comentariosCliente: comentarios.value,
    formaPagoSolicitada: formaPagoSolicitada.value,
    plazoEntrega: plazoEntrega.value,
    lugarEntrega: lugarEntrega.value,
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
  <v-row class="gap-6">
    <!-- Columna principal -->
    <v-col cols="12" md="8" class="pa-0">
      <v-card class="glass mb-6" elevation="8">
        <v-card-text>
          <div class="section-title">
            <Icon name="mdi:information-outline" class="text-primary" />
            <span>Datos básicos</span>
          </div>

          <v-row>
            <v-col cols="12" md="4">
              <v-text-field
                label="Fecha"
                :model-value="new Date().toLocaleDateString()"
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
                :model-value="user.nombre || '...' "
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
            <v-col cols="12" md="6">
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

            <v-col cols="12" md="6">
              <v-select
                v-model="tarifa"
                :items="tarifas"
                :rules="[required]"
                label="Tarifa"
                variant="outlined"
                density="comfortable"
                placeholder="Selecciona tarifa"
              >
                <template #prepend-inner>
                  <Icon name="mdi:tag-outline" />
                </template>
              </v-select>
            </v-col>
          </v-row>
          <!-- Forma de pago solicitada (obligatoria) -->
          <v-row>
            <v-col cols="12">
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
            <th style="min-width:220px">Artículo</th>
            <th class="text-center" style="width:74px">URL</th>
            <th class="num" style="width:90px">Unid.</th>
            <th class="num" style="width:150px">Precio Tarifa (€)</th>
            <th class="num" style="width:150px">
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
            <th class="num" style="width:130px">Total</th>
            <th style="width:56px"></th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="(row, i) in articulos" :key="i">
            <!-- Artículo -->
            <td>
              <v-text-field
                v-model="row.articulo"
                variant="outlined" density="compact" hide-details
                placeholder="Código o descripción"
                :disabled="isLocked(i)"
              >
                <template #prepend-inner><Icon name="mdi:barcode" /></template>
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
            <td class="num">
              <v-text-field
                v-model.number="row.unidades" :rules="[positive]"
                type="number" min="0"
                variant="outlined" density="compact" hide-details
                style="max-width:90px"
                :disabled="isLocked(i)"
              >
                <template #prepend-inner><Icon name="mdi:counter" /></template>
              </v-text-field>
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

            <!-- Solicitado -->
    <td class="num">
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
<v-card class="glass mb-6" elevation="8">
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
        label="Añadir archivos"
        variant="outlined"
        density="comfortable"
        multiple
        show-size
        accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv"
        prepend-icon=""
        @change="onPickFiles"
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
      <v-card class="glass" elevation="8">
        <v-card-text>
          <div class="section-title">
            <Icon name="mdi:clipboard-list-outline" class="text-primary" />
            <span>Información adicional</span>
          </div>
          <v-row>
            <v-col cols="12" md="6">
              <v-switch v-model="stockDisponible" color="primary" label="¿Unidades en stock?" />
            </v-col>
            <v-col cols="12" md="6">
              <v-switch v-model="compradoAntes" color="primary" label="¿Nos lo ha comprado anteriormente?" />
            </v-col>
          </v-row>
          <!-- Comentario sobre artículos si hay stock -->
          <v-row v-if="stockDisponible">
            <v-col cols="12">
                <v-alert
                    color="amber-lighten-1"
                    variant="tonal"
                    border="start"
                    class="mb-4"
                  >
                    Antes de confirmar, comprueba que haya unidades de todo. Si es parcial, comunícalo;
                    si es un equipo y falta algún componente, indícalo también.
                  </v-alert>
              <v-textarea
                v-model="comentarioStock"
                label="Comentario sobre artículos (opcional)"
                rows="2"
                variant="outlined"
                density="comfortable"
              />
              
            </v-col>
          </v-row>

          <v-row v-if="compradoAntes">
            <v-col cols="12" md="6">
              <v-text-field v-model.number="precioAnterior" :rules="[positive]" label="Precio anterior" variant="outlined" >
                <template #prepend-inner><Icon name="mdi:history" /></template>
              </v-text-field>
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12" md="6">
              <v-text-field v-model="fechaDecision" label="Fecha de decisión" type="date" variant="outlined">
                <template #prepend-inner><Icon name="mdi:calendar-check-outline" /></template>
              </v-text-field>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="plazoEntrega" label="Plazo de entrega" variant="outlined" placeholder="Ej: 7 días">
                <template #prepend-inner><Icon name="mdi:truck-delivery-outline" /></template>
              </v-text-field>
            </v-col>
          </v-row>
          <!-- Lugar de entrega (100%) -->
          <v-row>
            <v-col cols="12">
              <v-text-field
                v-model="lugarEntrega"
                label="Lugar de entrega (dirección completa)"
                variant="outlined"
                density="comfortable"
              >
                <template #prepend-inner>
                  <Icon name="mdi:map-marker" />
                </template>
              </v-text-field>
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12" md="6">
              <v-switch v-model="licitacion" color="primary" label="¿Es licitación?" />
            </v-col>
            <v-col cols="12" md="6" v-if="licitacion">
              <v-text-field v-model="clienteFinal" :rules="[required]" label="Cliente final (obligatorio si es licitación)" variant="outlined">
                <template #prepend-inner><Icon name="mdi:account-group-outline" /></template>
              </v-text-field>
            </v-col>
          </v-row>


          <v-textarea
            v-model="comentarios"
            label="Comentarios del cliente"
            variant="outlined"
            rows="3"
            auto-grow
          >
            <template #prepend-inner><Icon name="mdi:comment-text-outline" /></template>
          </v-textarea>
          <!-- Lista de errores -->
            <v-alert
              v-if="errores.length"
              type="error"
              variant="tonal"
              class="my-4"
            >
              <ul>
                <li v-for="(e, i) in errores" :key="i">{{ e }}</li>
              </ul>
            </v-alert>
          <div class="mt-6">
                <v-btn :loading="cotStore.saving" color="primary" size="large" @click="onSubmit">
                <Icon name="mdi:send-outline" class="me-2" />
                  {{ props.mode === 'edit' ? 'Guardar cambios' : 'Enviar solicitud' }}
                </v-btn>
            </div>

            <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="bottom right">
                {{ snackbar.text }}
            </v-snackbar>
        </v-card-text>
      </v-card>
    </v-col>

    <!-- Columna resumen -->
    <v-col cols="12" md="3" class="pa-0 pl-5">
      <v-card class="glass sticky" elevation="10">
        <v-card-text>
          <div class="section-title mb-2">
            <Icon name="mdi:chart-donut" class="text-primary" />
            <span>Resumen</span>
          </div>

          <div class="summary-row">
            <span>Total sin Cotizar</span>
            <strong>€ {{ totalCliente.toFixed(2) }}</strong>
          </div>
          <div class="summary-row">
            <span>Total Sugerido</span>
            <strong>€ {{ totalCotizado.toFixed(2) }}</strong>
          </div>
          <v-divider class="my-2" />
          <div class="summary-row accent" :class="{ good: ahorro >= 0, bad: ahorro < 0 }">
            <span>Ahorro</span>
            <strong>€ {{ ahorro.toFixed(2) }} ({{ ahorroPct.toFixed(1) }}%)</strong>
          </div>

          <v-alert
            v-if="!stockDisponible"
            type="warning"
            variant="tonal"
            class="mt-4"
            density="comfortable"
            title="Sin stock"
            text="Se notificará automáticamente a Compras cuando se envíe."
          />
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>

<style scoped lang="css">
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
.modern-table td{
  padding:8px 10px; vertical-align:middle;
}
.modern-table .num{ min-width:140px; text-align:right }
.total-cell{ font-weight:600; color:#0f172a }
.actions{ width:56px; text-align:center }
.sticky{
  position: sticky; top: 24px;
}
.summary-row{
  display:flex; justify-content:space-between; padding:.4rem 0;
  font-size: .98rem;
}
.summary-row.accent strong{ font-size:1.05rem }
.summary-row.good strong{ color:#16a34a }
.summary-row.bad  strong{ color:#dc2626 }
</style>

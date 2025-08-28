<script setup lang="ts">
import { useCotizacionesStore } from "~/stores/cotizaciones"
import { useUserStore } from "~/stores/user"
import { toRaw } from "vue"

const props = defineProps<{
  mode?: 'create' | 'edit',
  initial?: any
}>()
const emit = defineEmits<{
  (e:'submit', payload:any): void
}>()

type Row = {
  articulo: string
  url: string
  unidades: number
  precioCliente: number
  precioCotizado?: number // opcional
  mostrarPrecioSugerido?: boolean // controla si se ve el input
}


const user = useUserStore()

// Datos principales
const cliente = ref("")
const tarifa  = ref<string | null>(null)
const tarifas = ["A1","A2","A3","A4","A5","A6","A7"]
const fechaDecision = ref<string | null>(null)

// Artículos
const articulos = ref<Row[]>([
  { articulo: "", url: "", unidades: 1, precioCliente: 0, precioCotizado: undefined, mostrarPrecioSugerido: false }
])

// Estado de errores
const errores = ref<string[]>([])

// Inicialización si es edición
onMounted(() => {
  if (props.mode === "edit" && props.initial) {
    cliente.value = props.initial.cliente || ""
    tarifa.value = props.initial.tarifa || ""
    articulos.value = props.initial.articulos?.length
    ? props.initial.articulos.map((a: any) => ({
        ...a,
        mostrarPrecioSugerido: a.precioCotizado !== undefined // si ya tiene precio, mostrar campo
      }))
    : [{ articulo: "", url: "", unidades: 0, precioCliente: 0, precioCotizado: undefined, mostrarPrecioSugerido: false }]
    stockDisponible.value = props.initial.stockDisponible ?? true
    licitacion.value = !!props.initial.licitacion
    clienteFinal.value = props.initial.clienteFinal || ""
    comentarios.value = props.initial.comentariosCliente || ""
    formaPagoSolicitada.value = props.initial?.formaPagoSolicitada || ""
    plazoEntrega.value       = props.initial?.plazoEntrega || ""
    lugarEntrega.value       = props.initial?.lugarEntrega || ""
    comentarioStock.value    = props.initial?.comentarioStock || ""
    compradoAntes.value    = !!props.initial.compradoAntes
    precioAnterior.value    = props.initial.precioAnterior || null
    precioCompet.value      = props.initial.precioCompet || null
  }
})

function addArticulo() {
  articulos.value.push({
    articulo: "",
    url: "",
    unidades: 1,
    precioCliente: 0,
    precioCotizado: undefined,
    mostrarPrecioSugerido: false
  })
}
function removeArticulo(i:number){
  articulos.value.splice(i,1)
}

// Campos adicionales
const stockDisponible = ref(true)
const compradoAntes   = ref(false)
const precioAnterior  = ref<number | null>(null)
const licitacion      = ref(false)
const clienteFinal    = ref("")
const precioCompet    = ref<number | null>(null)
const comentarios     = ref("")
const formaPagoSolicitada = ref("")
const plazoEntrega  = ref("")
const lugarEntrega = ref("")
const comentarioStock = ref("")

// Totales
const totalCliente  = computed(()=> articulos.value.reduce((a,r)=> a + (r.unidades||0) * (r.precioCliente||0), 0))
const totalCotizado = computed(()=> articulos.value.reduce((a,r)=> a + (r.unidades||0) * (r.precioCotizado||0), 0))
const ahorro        = computed(()=> totalCliente.value - totalCotizado.value)
const ahorroPct     = computed(()=> totalCliente.value>0 ? (ahorro.value/totalCliente.value)*100 : 0)

// Reglas simples
const required = (v:any)=> (!!v || v===0) || "Obligatorio"
const positive = (v:any)=> (v===null || v===undefined || Number(v) >= 0) || "Debe ser ≥ 0"

// Enviar cotización
const cotStore = useCotizacionesStore()
const snackbar = ref<{show:boolean; text:string; color:string}>({show:false,text:"",color:"success"})

function validar(): boolean {
  errores.value = []

  if (!cliente.value.trim()) {
    errores.value.push("El campo Cliente es obligatorio.")
  }
  if (!tarifa.value) {
    errores.value.push("Debe seleccionar una tarifa.")
  }
  if (!articulos.value.length) {
    errores.value.push("Debe añadir al menos un artículo.")
  }
  if (!formaPagoSolicitada.value.trim()) {
    errores.value.push("La 'Forma de pago solicitada' es obligatoria.")
  }
  articulos.value.forEach((a, i) => {
    if (!a.articulo || !String(a.articulo).trim()) {
      errores.value.push(`Artículo ${i + 1}: falta el nombre.`)
    }
    if (!a.unidades || a.unidades <= 0) {
      errores.value.push(`Artículo ${i + 1}: unidades debe ser > 0.`)
    }
    // precioCotizado: opcional, pero si se pone debe ser ≥ 0
    if (a.precioCotizado !== null && a.precioCotizado !== undefined) {
      if (isNaN(Number(a.precioCotizado)) || Number(a.precioCotizado) < 0) {
        errores.value.push(`Artículo ${i + 1}: el precio sugerido debe ser ≥ 0.`)
      }
    }
  })

  if (licitacion.value && !clienteFinal.value.trim()) {
    errores.value.push("Debe indicar el Cliente final en caso de licitación.")
  }

  return errores.value.length === 0
}

function onSubmit() {
  if (!validar()) return

  const articulosSanitizados = articulos.value.map(a => ({
    ...a,
    precioCliente: Number(a.precioCliente || 0),
    precioCotizado: (a.precioCotizado !== null && a.precioCotizado !== undefined)
      ? Number(a.precioCotizado)
      : undefined
  }))

  const payload: any = {
    cliente: cliente.value,
    tarifa: tarifa.value,
    articulos: articulosSanitizados,
    stockDisponible: stockDisponible.value,
    licitacion: licitacion.value,
    clienteFinal: clienteFinal.value,
    comentariosCliente: comentarios.value,
    formaPagoSolicitada: formaPagoSolicitada.value,
    plazoEntrega: plazoEntrega.value,
    lugarEntrega: lugarEntrega.value,
    comentarioStock: comentarioStock.value
  }

  // Aquí añadimos los timestamps
  if (props.mode === "create") {
    payload.createdAt = new Date()         // o serverTimestamp() al enviar a Firestore
    payload.updatedAt = new Date()
  } else if (props.mode === "edit") {
    payload.updatedAt = new Date()
  }

  const safePayload = JSON.parse(JSON.stringify(payload))
  emit('submit', safePayload)
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
                  <th>URL</th>
                  <th class="num">Unid.</th>
                  <th>Precio Cliente (€)</th>
                  <th>Precio sugerido Cliente (opcional) (€)</th>
                  <th class="num">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in articulos" :key="i">
                  <td>
                    <v-text-field v-model="row.articulo" variant="outlined" density="compact" hide-details placeholder="Código o descripción">
                      <template #prepend-inner><Icon name="mdi:barcode" /></template>
                    </v-text-field>
                  </td>
                  <td>
                    <v-text-field v-model="row.url" variant="outlined" density="compact" hide-details placeholder="https://..." type="url">
                      <template #prepend-inner><Icon name="mdi:link-variant" /></template>
                    </v-text-field>
                  </td>
                  <td class="num">
                    <v-text-field v-model.number="row.unidades" :rules="[positive]" type="number" min="0" variant="outlined" density="compact" hide-details>
                      <template #prepend-inner><Icon name="mdi:counter" /></template>
                    </v-text-field>
                  </td>
                  <td class="num">
                    <v-text-field v-model.number="row.precioCliente" :rules="[positive]" type="number" min="0" variant="outlined" density="compact" hide-details >
                      <template #prepend-inner><Icon name="mdi:currency-eur" /></template>
                    </v-text-field>
                  </td>
                  <td class="num">
                    <v-text-field
                      v-if="row.mostrarPrecioSugerido"
                      v-model.number="row.precioCotizado"
                      :rules="[positive]"
                      type="number"
                      min="0"
                      variant="outlined"
                      density="compact"
                      hide-details
                      placeholder="Opcional"
                    >
                      <template #prepend-inner><Icon name="mdi:currency-eur" /></template>
                    </v-text-field>

                    <v-btn
                      v-else
                      icon
                      variant="text"
                      @click="row.mostrarPrecioSugerido = true"
                      title="Añadir precio sugerido"
                    >
                      <Icon name="mdi:plus" />
                    </v-btn>
                  </td>

                  <td>{{ ((Number(row.unidades)||0) * (Number(row.precioCliente)||0)).toFixed(2) }} €</td>
                  <td class="actions">
                    <v-btn icon variant="text" @click="removeArticulo(i)">
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

          <v-row>
            <v-col cols="12" md="6">
              <v-text-field v-model.number="precioCompet" :rules="[positive]" label="Precio competencia" variant="outlined"  placeholder="Opcional">
                <template #prepend-inner><Icon name="mdi:sword-cross" /></template>
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

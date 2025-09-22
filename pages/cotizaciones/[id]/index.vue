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

const SUPERVISOR_ROLE = 'jefe_comercial'
const supervisorEmail = ref<string|null>(null)

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
function sumLineas(art:any[], field:'precioCliente'|'precioCotizado'){
  return (art || []).reduce((a,r)=> a + (Number(r.unidades)||0)*(Number(r[field]||0)||0), 0)
}
function getCounterpartyEmail(): string | null {
  const role = (user.rol || '').toLowerCase()
  const isSup = role === SUPERVISOR_ROLE || role.includes('vanes') || (user as any).esSupervisor === true
  if (isSup) return cot.value?.vendedor?.email || null
  if (role === 'comercial' || user.uid === cot.value?.vendedor?.uid) return supervisorEmail.value
  return cot.value?.vendedor?.email || supervisorEmail.value || null
}
const totalCotizado = computed(() => sumLineas(cot.value?.articulos || [], 'precioCliente'))

const isSupervisor = computed(() => {
  const r = (user.rol || '').toLowerCase()
  return r === 'admin' || r === 'jefe_comercial' || r.includes('vanes')
})
const isOwner = computed(() => user.uid && user.uid === (cot.value?.vendedor?.uid || cot.value?.vendedorUid))
const puedeAccionar = computed(() => isSupervisor.value)
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

// Snapshots
let stopDoc: null | (() => void) = null
let stopComments: null | (() => void) = null

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
  loadSupervisor().catch(console.error)
})
onUnmounted(() => { stopDoc?.(); stopComments?.() })

// ===== Slack via Nuxt server API =====
async function notifySlack(text: string, toEmailOverride?: string | null) {
  try {
    const toEmail = toEmailOverride || getCounterpartyEmail()
    if (!toEmail) { console.warn('Slack: sin destinatario'); return }
    await $fetch('/api/slack/dm', { method:'POST', body:{ toEmail, text } })
  } catch (e:any) {
    console.error('Slack DM error:', e?.data || e)
  }
}

// ===== Acciones =====
async function addComment() {
  const texto = newComment.value.trim()
  if (!texto && !fileToUpload.value) return

  let attachment = null
  if (fileToUpload.value) {
    if (import.meta.server) return
    await ensureAuth()
    const path = `cotizaciones/${id.value}/attachments/${Date.now()}_${fileToUpload.value.name}`
    const fileRef = storageRef($storage, path)
    await uploadBytes(fileRef, fileToUpload.value)
    const url = await getDownloadURL(fileRef)
    attachment = { nombre: fileToUpload.value.name, url, tipo: fileToUpload.value.type }
  }

  await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
    texto: texto || null,
    attachment,
    fecha: serverTimestamp(),
    author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
  })

  newComment.value = ''
  fileToUpload.value = null
  await updateDoc(doc($db, 'cotizaciones', id.value), { updatedAt: serverTimestamp() })

  await notifySlack(`💬 ${user.nombre} comentó en la cotización “${cot.value?.nombre || cot.value?.cliente || id.value}”: “${texto}”`)
}

async function setWorkflow(flow: 'en_revision'|'consultando'|'espera_cliente') {
  if (!cot.value) return
  await updateDoc(doc($db, 'cotizaciones', id.value), { workflow: flow, updatedAt: serverTimestamp() })
  const msg = `🔄 ${user.nombre} cambió el estado de la cotización “${cot.value?.cliente || id.value}” a *${flow.replace('_',' ')}*.`
  if (isSupervisor.value) await notifySlack(msg, cot.value?.vendedor?.email)
  else if (flow === 'espera_cliente') await notifySlack(msg, supervisorEmail.value)
}

async function aceptar() {
  if (!cot.value) return
  await updateDoc(doc($db, 'cotizaciones', id.value), { estado: 'resuelta', updatedAt: serverTimestamp() })
  const msg = `✅ ${user.nombre} marcó la cotización “${cot.value?.cliente || id.value}” como *ACEPTADA*.`
  if (cot.value?.vendedor?.email) await notifySlack(msg, cot.value.vendedor.email)
  if (supervisorEmail.value) await notifySlack(msg, supervisorEmail.value)
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
    fecha: serverTimestamp(),
    author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
  })

  await notifySlack(`🔁 Cotización “${cot.value?.nombre || cot.value?.cliente || id.value}” reasignada a ${update.vendedor.nombre}`)
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
    fecha: serverTimestamp(),
    author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
  })
  await updateDoc(doc($db, 'cotizaciones', id.value), { updatedAt: serverTimestamp() })
  await notifySlack(`📎 ${user.nombre} adjuntó “${f.name}” en la cotización “${cot.value?.nombre || cot.value?.cliente || id.value}”`)
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
              <v-chip :color="estadoChip(cot.estado).color" size="small" label>
                {{ estadoChip(cot.estado).text }}
              </v-chip>
              <v-chip v-if="cot.workflow" color="info" size="small" label>
                {{ cot.workflow === 'en_revision' ? 'En revisión'
                   : cot.workflow === 'consultando' ? 'Consultando proveedor'
                   : cot.workflow === 'espera_cliente' ? 'A la espera del cliente'
                   : cot.workflow }}
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
                Total: € {{ totalCotizado.toFixed(2) }}
              </v-chip>
            </div>
          </div>
        </v-card>

        <v-row>
          <!-- IZQUIERDA: Comentarios -->
         <v-col cols="12" md="4">
            <v-card class="pa-4 d-flex flex-column comments-card">
              <!-- Input arriba -->
              <div class="d-flex align-center justify-space-between mb-2"> <h3 class="text-subtitle-1 font-weight-bold">Comentarios y actividad</h3> </div>
              <div class="comment-input-box">
                <v-textarea
                  v-model="newComment"
                  label="Escribe un comentario…"
                  rows="2"
                  auto-grow
                  variant="outlined"
                  hide-details
                />

                <div class="d-flex ga-2 mt-2 mb-2">
                  <v-btn color="primary" @click="addComment">
                    <template #prepend><Icon name="mdi:comment-plus-outline" class="me-1" /></template>
                    Añadir comentario
                  </v-btn>
                  <v-btn icon variant="plain" @click="$refs.fileInput.click()">
                    <Icon name="mdi:paperclip"/>
                  </v-btn>
                  <input type="file" ref="fileInput" class="d-none" @change="onFileChange" />
                </div>
              </div>

              <v-divider class="my-2" />

              <!-- Scroll SOLO en los comentarios -->
              <div class="comments-scroll">
                <div class="d-flex ga-3 mb-3">
                  <v-avatar :color="colorByRol(cot.vendedor?.rol, cot.vendedor?.nombre)" size="36">
                    {{ initials(cot.vendedor?.nombre || 'Vendedor') }}
                  </v-avatar>
                  <div>
                    <div class="text-body-2">
                      <strong>{{ cot.vendedor?.nombre || 'Vendedor' }}</strong>
                      ha creado esta cotización
                    </div>
                    <small class="text-medium-emphasis">
                      {{ fmt(cot.fechaCreacion || cot.fecha) }} · #{{ cot.numero }}
                      · € {{ totalCotizado.toFixed(2) }}
                    </small>
                  </div>
                </div>

                <div v-for="c in comments" :key="c.id" class="d-flex ga-3 mb-3">
                  <v-avatar :color="colorByRol(c.author?.rol, c.author?.nombre || c.user)" size="36">
                    {{ initials(c.author?.nombre || c.user || '—') }}
                  </v-avatar>
                  <div>
                    <div class="text-body-2">
                      <strong>{{ c.author?.nombre || c.user || '—' }}</strong>
                      <small class="text-medium-emphasis"> · {{ fmt(c.fecha) }}</small>
                    </div>
                    <div v-if="c.attachment" class="mt-2">
                      Ha adjuntado un documento: <br/><Icon name="mdi:paperclip"/>
                      <a :href="c.attachment.url" target="_blank" rel="noopener">
                        {{ c.attachment.nombre }}
                      </a>
                    </div>
                    <div class="mt-1">{{ c.texto }}</div>
                  </div>
                </div>
              </div>
            </v-card>
          </v-col>



          <!-- DERECHA: Detalles -->
          <v-col cols="12" md="8">
            <v-card class="pa-4">
              <div class="d-flex justify-space-between align-center mb-4">
               <h3 class="text-subtitle-1 font-weight-bold mb-3">Detalles de la cotización</h3>
                <v-icon-btn color="blue-lighten-5" v-if="isOwner" @click="navigateTo(`/cotizaciones/${id}/editar`)" class="text-primary">
                  <Icon name="mdi:pencil" class="text-xl" />
                </v-icon-btn>
              </div>

              <div class="d-flex flex-wrap ga-6 mb-4">
                <div>
                  <div class="text-medium-emphasis text-caption">Cliente</div>
                  <div class="font-weight-medium">{{ cot.cliente || '—' }}</div>
                </div>
                <div>
                  <div class="text-medium-emphasis text-caption">Vendedor</div>
                  <div class="font-weight-medium">{{ cot.vendedor?.nombre || '—' }}</div>
                </div>
                <div>
                  <div class="text-medium-emphasis text-caption">Tarifa</div>
                  <div class="font-weight-medium">{{ cot.tarifa || '—' }}</div>
                </div>
                <div>
                  <div class="text-medium-emphasis text-caption">Licitación</div>
                  <v-chip size="small" :color="(cot.licitacion ? 'primary' : 'grey')" label>
                    {{ cot.licitacion ? 'Sí' : 'No' }}
                  </v-chip>
                </div>
                <div>
                  <div class="text-medium-emphasis text-caption">Stock</div>
                  <v-chip size="small" :color="(cot.stockDisponible === false ? 'error' : 'success')" label>
                    {{ cot.stockDisponible === false ? 'Sin stock' : 'Con stock' }}
                  </v-chip>
                </div>

                <div v-if="cot.formaPagoSolicitada">
                  <div class="text-medium-emphasis text-caption">Forma de pago solicitada</div>
                  <div class="font-weight-medium">{{ cot.formaPagoSolicitada }}</div>
                </div>
                <div v-if="cot.plazoEntrega">
                  <div class="text-medium-emphasis text-caption">Plazo de entrega</div>
                  <div class="font-weight-medium">{{ cot.plazoEntrega }}</div>
                </div>
                <div v-if="cot.lugarEntrega" class="w-100">
                  <div class="text-medium-emphasis text-caption">Lugar de entrega</div>
                  <div class="font-weight-medium">{{ cot.lugarEntrega }}</div>
                </div>
                <div v-if="cot.comentarioStock" class="w-100">
                  <div class="text-medium-emphasis text-caption">Comentario de stock</div>
                  <div>{{ cot.comentarioStock }}</div>
                </div>
              </div>

              <v-table density="comfortable">
                <thead>
                  <tr>
                    <th>Artículo</th>
                    <th class="text-right">Unid.</th>
                    <th class="text-right">Precio cliente</th>
                    <th class="text-right">Precio sugerido (opcional)</th>
                    <th class="text-right">Total (cliente)</th>
                    <th class="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(a,i) in cot.articulos || []" :key="i">
                    <td>{{ a.articulo }}</td>
                    <td class="text-right">{{ a.unidades || 0 }}</td>
                    <td class="text-right">€ {{ (Number(a.precioCliente||0)).toFixed(2) }}</td>
                    <td class="text-right">
                      <span v-if="a.precioCotizado">€ {{ (Number(a.precioCotizado||0)).toFixed(2) }}</span>
                      <span v-else>—</span>
                    </td>
                    <td class="text-right">
                      € {{ ((Number(a.unidades||0)*Number(a.precioCliente||0))).toFixed(2) }}
                    </td>
                    <td class="text-right">
                      <v-btn :href="a.url || undefined" :disabled="!a.url" target="_blank" rel="noopener" variant="tonal" color="primary" size="small">
                        <template #prepend><Icon name="mdi:open-in-new" class="me-1" /></template>
                        Ver artículo en web
                      </v-btn>
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </v-card>

            <!-- Acciones -->
            <div class="d-flex ga-3 mt-6">
              <!-- SOLO visibles si NO está resuelta -->
              <template v-if="cot.estado !== 'resuelta'">
                <v-btn
                  v-if="isSupervisor"
                  :disabled="cot.workflow === 'en_revision'"
                  color="warning"
                  @click="setWorkflow('en_revision')"
                >
                  <template #prepend><Icon name="mdi:eye" class="me-2" /></template>
                  En revisión
                </v-btn>

                <v-btn
                  v-if="isSupervisor"
                  :disabled="cot.workflow === 'consultando'"
                  color="info"
                  @click="setWorkflow('consultando')"
                >
                  <template #prepend><Icon name="mdi:truck" class="me-2" /></template>
                  Consultando proveedor
                </v-btn>

                <v-btn
                  v-if="(isSupervisor || isOwner) && cot.estado !== 'resuelta'"
                  :disabled="cot.workflow === 'espera_cliente'"
                  color="secondary"
                  @click="setWorkflow('espera_cliente')"
                >
                  <template #prepend><Icon name="mdi:account-clock" class="me-2" /></template>
                  A la espera del cliente
                </v-btn>

                <v-spacer />

                <v-btn
                  v-if="isSupervisor && cot.estado !== 'resuelta'"
                  color="success"
                  @click="aceptar"
                >
                  <template #prepend><Icon name="mdi:check-decagram" class="me-2" /></template>
                  Aceptar
                </v-btn>

                <v-btn
                  v-if="isSupervisor && cot.estado !== 'resuelta'"
                  color="secondary"
                  @click="abrirReasignar"
                >
                  <template #prepend><Icon name="mdi:account-switch" class="me-2" /></template>
                  Reasignar
                </v-btn>
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
      </template>
    </template>
  </v-container>
</template>
<style scoped>
.comments-card {
  height: 66vh; /* altura total del card */
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


</style>
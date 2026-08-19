<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where, getDocs, serverTimestamp
} from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useUserStore } from '~/stores/user'
import { normalizeStockEstado, stockDisponibleLegacy, shouldResetComprasAtendido } from '~/utils/stock'
import { cotizacionCompradoAntes, mergeArticuloEdicion, articuloLabel } from '~/utils/articulos'
import { tarifaLabel } from '~/utils/tarifas'
import { workflowLabel } from '~/utils/workflow'
import { puedeActuarComercialEnCotizacion, isCotizacionOwner } from '~/utils/cotizacion-access'

const { $db, $storage, $auth } = useNuxtApp()
const route = useRoute()
const user = useUserStore()

definePageMeta({ middleware: ['role-comercial'] })

async function ensureAuth() {
  if ($auth.currentUser) return
  const { signInAnonymously } = await import('firebase/auth')
  await signInAnonymously($auth)
}

const id = computed(() => String(route.params.id))
const detailUrl = computed(() => `/cotizaciones/${id.value}`)

const loading = ref(true)
const saving  = ref(false)
const errorMsg = ref<string>('')

const cot = ref<any | null>(null)
const supervisorEmail = ref<string | null>(null)

const isVanessaOrAdmin = computed(() => {
  const r = (user.rol || '').toLowerCase()
  return r === 'admin' || r.includes('vanes') || r === 'jefe_comercial'
})
const puedeActuarComercial = computed(() => puedeActuarComercialEnCotizacion(user, cot.value))
const isSoloParticipante = computed(() =>
  puedeActuarComercial.value && !isCotizacionOwner(user.uid, cot.value, user.email),
)
const isCotizada = computed(() => (cot.value?.workflow || '').toLowerCase() === 'cotizado')
const isGanada = computed(() => (cot.value?.estado || '').toLowerCase() === 'ganada')
const isPerdida = computed(() => (cot.value?.estado || '').toLowerCase() === 'perdida')
const isAplazada = computed(() => (cot.value?.estado || '').toLowerCase() === 'aplazada')
const cotizacionAbierta = computed(() => !isCotizada.value && !isGanada.value && !isPerdida.value && !isAplazada.value)
const canEditArticulos = computed(() =>
  (puedeActuarComercial.value || user.isCompras) && cotizacionAbierta.value,
)
/** Comercial o participante: edición completa con reapertura al guardar */
const canEditComercialFull = computed(() =>
  puedeActuarComercial.value && !user.isCompras && !isVanessaOrAdmin.value && cotizacionAbierta.value,
)
const articulosOnlyMode = computed(() => user.isCompras && canEditArticulos.value)
const canEditFull = computed(() =>
  (isVanessaOrAdmin.value || canEditComercialFull.value) && cotizacionAbierta.value,
)
const canAccess = computed(() => canEditFull.value || articulosOnlyMode.value)

async function loadSupervisor() {
  const q1 = query(collection($db, 'usuarios'), where('rol', '==', 'jefe_comercial'))
  const s1 = await getDocs(q1)
  if (s1.docs.length) {
    supervisorEmail.value = s1.docs[0].data().email || null
    return
  }
  const q2 = query(collection($db, 'usuarios'), where('esSupervisor', '==', true))
  const s2 = await getDocs(q2)
  supervisorEmail.value = s2.docs[0]?.data()?.email || 'vanessa@comercialav.com'
}

async function notifySlack(text: string, event: string) {
  try {
    const toEmail = supervisorEmail.value || cot.value?.vendedor?.email
    if (!toEmail) return
    await $fetch('/api/slack/dm', { method: 'POST', body: { toEmail, text, event } })
  } catch (e: any) {
    console.error('[EDIT] Slack error:', e?.data || e)
  }
}

function diffArticulos(antes: any[], despues: any[]) {
  const lines: string[] = []
  const max = Math.max(antes.length, despues.length)
  for (let i = 0; i < max; i++) {
    const a = antes[i]
    const d = despues[i]
    if (!a && d) {
      lines.push(`➕ Añadido “${articuloLabel(d)}” (${d.unidades} uds)`)
      continue
    }
    if (a && !d) {
      lines.push(`➖ Eliminado “${articuloLabel(a)}”`)
      continue
    }
    if (!a || !d) continue
    const changes: string[] = []
    if ((a.codigoProducto || '') !== (d.codigoProducto || '')) {
      changes.push(`código “${a.codigoProducto || '—'}” → “${d.codigoProducto || '—'}”`)
    }
    if ((a.descripcionProducto || '') !== (d.descripcionProducto || '')) {
      changes.push(`descripción actualizada`)
    }
    if (a.articulo !== d.articulo && !changes.length) changes.push(`nombre “${a.articulo}” → “${d.articulo}”`)
    if (Number(a.unidades) !== Number(d.unidades)) changes.push(`uds ${a.unidades} → ${d.unidades}`)
    if (Number(a.precioCliente) !== Number(d.precioCliente)) changes.push(`tarifa €${a.precioCliente} → €${d.precioCliente}`)
    if (Number(a.precioSolicitado ?? -1) !== Number(d.precioSolicitado ?? -1)) {
      changes.push(`solicitado €${a.precioSolicitado ?? '—'} → €${d.precioSolicitado ?? '—'}`)
    }
    if (Number(a.precioCoste ?? -1) !== Number(d.precioCoste ?? -1)) {
      changes.push(`coste €${a.precioCoste ?? '—'} → €${d.precioCoste ?? '—'}`)
    }
    if ((a.proveedor || '') !== (d.proveedor || '')) {
      changes.push(`proveedor "${a.proveedor || '—'}" → "${d.proveedor || '—'}"`)
    }
    if ((a.url || '') !== (d.url || '')) changes.push('URL actualizada')
    if (changes.length) lines.push(`✏️ “${articuloLabel(d)}”: ${changes.join(', ')}`)
  }
  return lines
}

function fmtWorkflow(w?: string) {
  return workflowLabel(w)
}

async function load() {
  try {
    loading.value = true
    const snap = await getDoc(doc($db, 'cotizaciones', id.value))
    if (!snap.exists()) {
      cot.value = null
      return
    }
    cot.value = { id: snap.id, ...snap.data() }
  } catch (e) {
    console.error('[EDIT] error cargando', e)
    errorMsg.value = 'No se pudo cargar la cotización.'
  } finally {
    loading.value = false
  }
}

function cleanData(obj: any) {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined))
}

async function onSubmitArticulosOnly(nuevosArticulos: any[]) {
  const now = serverTimestamp()
  const antes = cot.value?.articulos || []
  const articulosGuardados = nuevosArticulos.map((line, i) =>
    mergeArticuloEdicion(antes[i], line),
  )
  const cambios = diffArticulos(antes, articulosGuardados)

  await updateDoc(doc($db, 'cotizaciones', id.value), {
    articulos: articulosGuardados,
    updatedAt: now,
  })

  const stamp = new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date())

  const rolLabel = user.isCompras ? 'Compras' : (user.nombre || 'Comercial')
  const detalle = cambios.length
    ? cambios.map(c => `• ${c}`).join('\n')
    : '• Sin cambios detectados en las líneas'

  const texto = `✏️ ${rolLabel} modificó artículos (${stamp}):\n${detalle}`

  // Los cambios de coste/proveedor son sensibles: ocultar a comerciales
  const contieneDatosSensibles = /coste €|proveedor "/i.test(texto)

  await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
    fecha: now,
    tipo: 'actividad',
    ...(contieneDatosSensibles ? { visibilidad: 'privado' } : {}),
    author: { uid: user.uid, nombre: user.nombre, rol: user.rol },
    texto,
  })

  const ref = `#${cot.value?.numero || id.value} – ${cot.value?.cliente || ''}`
  await notifySlack(
    `${texto.replace(/\n/g, ' ')} en la cotización ${ref}.`,
    'articulos_editados',
  )

  await navigateTo(detailUrl.value)
}

async function onSubmit(payload: any) {
  const data = payload?.data
  const attachments: File[] = Array.isArray(payload?.attachments) ? payload.attachments : []

  if (!cot.value) return
  if (!canAccess.value) {
    errorMsg.value = 'No tienes permisos para editar esta cotización.'
    return
  }

  if (articulosOnlyMode.value) {
    saving.value = true
    errorMsg.value = ''
    try {
      await onSubmitArticulosOnly(data.articulos || [])
    } catch (e: any) {
      console.error('[EDIT] error guardando artículos', e)
      errorMsg.value = e?.message || 'Error guardando artículos'
    } finally {
      saving.value = false
    }
    return
  }

  if (!canEditFull.value) {
    errorMsg.value = 'No tienes permisos para editar esta cotización.'
    return
  }

  saving.value = true
  errorMsg.value = ''
  try {
    const now = serverTimestamp()
    const currentVersion = Number(cot.value.version || 1)
    const nextVersion = currentVersion + 1

    const snapshotDoc = cleanData({
      ...data,
      updatedAt: serverTimestamp(),
      version: nextVersion,
      snapshotDe: currentVersion,
      fecha: now,
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol },
      data: cleanData({
        cliente: cot.value.cliente,
        tarifa: cot.value.tarifa,
        articulos: cot.value.articulos,
        stockEstado: cot.value.stockEstado || normalizeStockEstado(cot.value),
        stockDisponible: cot.value.stockDisponible,
        licitacion: cot.value.licitacion,
        clienteFinal: cot.value.clienteFinal || null,
        comentariosCliente: cot.value.comentariosCliente || null,
        formaPagoSolicitada: cot.value.formaPagoSolicitada || null,
        formaPagoActual: cot.value.formaPagoActual || null,
        condicionesEspeciales: cot.value.condicionesEspeciales || null,
        plazoEntrega: cot.value.plazoEntrega || null,
        lugarEntrega: cot.value.lugarEntrega || null,
        tipoEntrega: cot.value.tipoEntrega || null,
        comentarioStock: cot.value.comentarioStock || null,
        compradoAntes: (cot.value.compradoAntes ?? false),
        fechaDecision: (cot.value.fechaDecision ?? null),
        estado: cot.value.estado,
        workflow: cot.value.workflow || null,
        version: cot.value.version || 1
      })
    })
    await setDoc(doc($db, 'cotizaciones', id.value, 'versiones', String(nextVersion)), snapshotDoc)

    const prevEstado = normalizeStockEstado(cot.value)
    const nextEstado = normalizeStockEstado(data)

    const updatePayload = cleanData({
      cliente: data.cliente,
      tarifa: data.tarifa,
      articulos: data.articulos,
        stockEstado: nextEstado,
        stockDisponible: stockDisponibleLegacy(nextEstado),
      licitacion: data.licitacion,
      clienteFinal: data.clienteFinal || null,
      comentariosCliente: data.comentariosCliente || null,
      formaPagoActual: data.formaPagoActual || null,
      condicionesEspeciales: data.condicionesEspeciales || null,
      plazoEntrega: data.plazoEntrega || null,
      lugarEntrega: data.lugarEntrega || null,
      tipoEntrega: data.tipoEntrega || null,
      comentarioStock: data.comentarioStock || null,
      compradoAntes: cotizacionCompradoAntes(data.articulos || []),
      fechaDecision: (data.fechaDecision ?? null),
      estado: 'reabierta',
      workflow: 'en_revision',
      version: nextVersion,
      updatedAt: now,
      ...(shouldResetComprasAtendido(prevEstado, nextEstado) ? {
        comprasAtendidoAt: null,
        comprasAtendidoPor: null,
        comprasRespondio: null,
      } : {}),
    })
    await updateDoc(doc($db, 'cotizaciones', id.value), updatePayload)

    if (attachments.length) {
      await ensureAuth()
      for (const f of attachments) {
        const path = `cotizaciones/${id.value}/adjuntos/${Date.now()}_${f.name}`
        const fileRef = storageRef($storage, path)
        await uploadBytes(fileRef, f)
        const url = await getDownloadURL(fileRef)
        await addDoc(collection($db, 'cotizaciones', id.value, 'adjuntos'), {
          nombre: f.name,
          url,
          tipo: f.type || null,
          size: f.size || null,
          path,
          createdAt: serverTimestamp(),
          author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
        })
      }
    }

    await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
      fecha: now,
      tipo: 'actividad',
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol },
      texto: isSoloParticipante.value
        ? `${user.nombre} (participante) editó la cotización. Se reabre para revisión.`
        : 'El comercial ha editado la cotización. Se reabre para revisión.',
    })

    await navigateTo(detailUrl.value)
  } catch (e:any) {
    console.error('[EDIT] error guardando', e)
    errorMsg.value = e?.message || 'Error guardando cambios'
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await loadSupervisor()
  await load()
})
</script>

<template>
  <div class="page-bg">
    <v-container class="py-6 edit-page">
      <v-skeleton-loader
        v-if="loading"
        :type="['heading', 'card', 'table', 'actions']"
      />

      <template v-else>
        <div v-if="!cot" class="empty-state">
          <v-alert type="error" variant="tonal" class="mb-4">
            No existe esta cotización.
          </v-alert>
          <v-btn color="primary" @click="navigateTo('/cotizaciones')">
            <template #prepend><Icon name="mdi:arrow-left" /></template>
            Volver al listado
          </v-btn>
        </div>

        <template v-else>
          <header class="page-header">
            <nav class="page-header__breadcrumb" aria-label="Navegación">
              <NuxtLink to="/cotizaciones" class="breadcrumb-link">Cotizaciones</NuxtLink>
              <Icon name="mdi:chevron-right" class="breadcrumb-sep" />
              <NuxtLink :to="detailUrl" class="breadcrumb-link">{{ cot.cliente }}</NuxtLink>
              <Icon name="mdi:chevron-right" class="breadcrumb-sep" />
              <span class="breadcrumb-current">{{ articulosOnlyMode ? 'Artículos' : 'Editar' }}</span>
            </nav>

            <div class="page-header__shell">
              <div class="page-header__row">
                <div class="page-header__identity">
                  <div class="page-header__avatar">
                    <Icon name="mdi:file-document-edit-outline" />
                  </div>
                  <div class="page-header__copy">
                    <p class="page-header__eyebrow">
                      {{ articulosOnlyMode ? 'Edición de artículos' : 'Edición de cotización' }}
                    </p>
                    <h1 class="page-header__title">{{ cot.cliente }}</h1>
                    <p v-if="cot.numero" class="page-header__ref">{{ cot.numero }}</p>
                  </div>
                </div>

                <div class="page-header__actions">
                  <v-btn
                    variant="text"
                    class="page-header__btn-ghost"
                    @click="navigateTo(detailUrl)"
                  >
                    <template #prepend><Icon name="mdi:arrow-left" /></template>
                    Volver
                  </v-btn>
                  <v-btn
                    color="primary"
                    variant="flat"
                    class="page-header__btn-primary"
                    @click="navigateTo(detailUrl)"
                  >
                    <template #prepend><Icon name="mdi:open-in-new" /></template>
                    Ver detalle
                  </v-btn>
                </div>
              </div>

              <div class="page-header__meta">
                <span class="meta-chip">
                  <Icon name="mdi:tag-outline" />
                  {{ tarifaLabel(cot.tarifa) }}
                </span>
                <span class="meta-chip">
                  <Icon name="mdi:source-branch" />
                  Versión {{ cot.version || 1 }}
                </span>
                <span v-if="cot.workflow" class="meta-chip">
                  <Icon name="mdi:progress-clock" />
                  {{ fmtWorkflow(cot.workflow) }}
                </span>
                <span v-if="cot.vendedor?.nombre" class="meta-chip meta-chip--muted">
                  <Icon name="mdi:account-tie-outline" />
                  {{ cot.vendedor.nombre }}
                </span>
              </div>

              <div class="page-header__notices">
                <div v-if="articulosOnlyMode" class="header-notice">
                  <span class="header-notice__icon header-notice__icon--blue">
                    <Icon name="mdi:cube-outline" />
                  </span>
                  <p class="header-notice__text">
                    Puedes modificar, añadir o eliminar artículos mientras la cotización
                    <strong>no esté cerrada</strong>. Los cambios quedarán registrados en el chat.
                  </p>
                </div>
                <template v-else-if="canEditFull">
                  <div v-if="canEditComercialFull" class="header-notice">
                    <span class="header-notice__icon header-notice__icon--indigo">
                      <Icon name="mdi:account-group-outline" />
                    </span>
                    <p class="header-notice__text">
                      <template v-if="isSoloParticipante">
                        Estás editando como <strong>participante</strong> mientras el vendedor no está disponible.
                      </template>
                      <template v-else>
                        Puedes corregir la cotización completa antes de que se cierre.
                      </template>
                    </p>
                  </div>
                  <div class="header-notice">
                    <span class="header-notice__icon header-notice__icon--amber">
                      <Icon name="mdi:refresh-circle" />
                    </span>
                    <p class="header-notice__text">
                      Al guardar, la cotización se reabrirá y volverá a
                      <strong>En revisión</strong> para que el supervisor la valide.
                    </p>
                  </div>
                  <div class="header-notice">
                    <span class="header-notice__icon header-notice__icon--blue">
                      <Icon name="mdi:cube-edit-outline" />
                    </span>
                    <p class="header-notice__text">
                      Puedes corregir cualquier artículo (nombre, unidades, precios),
                      añadir líneas nuevas o actualizar la información complementaria.
                    </p>
                  </div>
                </template>
              </div>
            </div>
          </header>

          <v-alert v-if="isCotizada || isGanada || isPerdida || isAplazada" type="info" variant="tonal" class="mb-4 permission-alert">
            Esta cotización ya está cerrada. No se pueden modificar los artículos.
          </v-alert>

          <v-alert v-else-if="!canAccess" type="warning" variant="tonal" class="mb-4 permission-alert">
            No tienes permisos para editar esta cotización.
          </v-alert>

          <ClientOnly v-if="canAccess">
            <CotizacionForm
              mode="edit"
              :initial="cot"
              :loading="saving"
              :detail-url="detailUrl"
              :articulos-only="articulosOnlyMode"
              :unlock-articulos="true"
              @submit="onSubmit"
            />
          </ClientOnly>

          <v-alert v-if="errorMsg" type="error" variant="tonal" class="mt-4">
            {{ errorMsg }}
          </v-alert>
        </template>
      </template>
    </v-container>
  </div>
</template>

<style scoped>
.page-bg{
  min-height: 100vh;
  background:
    radial-gradient(1200px 600px at 80% 0%, rgba(25,118,210,0.07), transparent 55%),
    radial-gradient(900px 500px at 0% 100%, rgba(14,165,233,0.06), transparent 55%),
    #f4f7fb;
}
.edit-page{
  max-width: 1280px;
}
.page-header{
  margin-bottom: 1.75rem;
}
.page-header__breadcrumb{
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:6px;
  margin-bottom:14px;
  font-size:.82rem;
  color:#64748b;
}
.breadcrumb-link{
  color:#64748b;
  text-decoration:none;
  transition:color .15s ease;
}
.breadcrumb-link:hover{
  color:#1976d2;
}
.breadcrumb-sep{
  font-size:.75rem;
  color:#cbd5e1;
}
.breadcrumb-current{
  color:#334155;
  font-weight:600;
}
.page-header__shell{
  background:rgba(255,255,255,0.92);
  border:1px solid rgba(15, 23, 42, 0.07);
  border-radius:20px;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 12px 40px rgba(15, 23, 42, 0.06);
  padding:22px 24px 20px;
  backdrop-filter:blur(8px);
}
.page-header__row{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:20px;
  flex-wrap:wrap;
}
.page-header__identity{
  display:flex;
  align-items:flex-start;
  gap:16px;
  min-width:0;
}
.page-header__avatar{
  width:52px;
  height:52px;
  border-radius:14px;
  display:grid;
  place-items:center;
  flex-shrink:0;
  background:linear-gradient(135deg, #dbeafe 0%, #eff6ff 100%);
  color:#1d4ed8;
  font-size:1.45rem;
  box-shadow:inset 0 0 0 1px rgba(59, 130, 246, 0.15);
}
.page-header__eyebrow{
  margin:0 0 4px;
  font-size:.72rem;
  font-weight:700;
  letter-spacing:.08em;
  text-transform:uppercase;
  color:#64748b;
}
.page-header__title{
  margin:0;
  font-size:clamp(1.35rem, 2vw, 1.75rem);
  font-weight:700;
  line-height:1.2;
  color:#0f172a;
  letter-spacing:-0.02em;
}
.page-header__ref{
  margin:6px 0 0;
  font-size:.88rem;
  color:#64748b;
  font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.page-header__actions{
  display:flex;
  align-items:center;
  gap:8px;
  flex-shrink:0;
}
.page-header__btn-ghost{
  color:#475569 !important;
}
.page-header__btn-primary{
  box-shadow:0 4px 14px rgba(25, 118, 210, 0.22);
}
.page-header__meta{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  margin-top:18px;
  padding-top:16px;
  border-top:1px solid rgba(15, 23, 42, 0.06);
}
.meta-chip{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:6px 12px;
  border-radius:999px;
  font-size:.78rem;
  font-weight:600;
  color:#334155;
  background:#f8fafc;
  border:1px solid rgba(15, 23, 42, 0.07);
}
.meta-chip--muted{
  color:#64748b;
  font-weight:500;
}
.page-header__notices{
  display:grid;
  gap:10px;
  margin-top:16px;
}
.header-notice{
  display:flex;
  align-items:flex-start;
  gap:12px;
  padding:12px 14px;
  border-radius:12px;
  background:#f8fafc;
  border:1px solid rgba(15, 23, 42, 0.06);
}
.header-notice__icon{
  width:32px;
  height:32px;
  border-radius:10px;
  display:grid;
  place-items:center;
  flex-shrink:0;
  font-size:1rem;
}
.header-notice__icon--amber{
  background:#fff7ed;
  color:#c2410c;
}
.header-notice__icon--blue{
  background:#eff6ff;
  color:#1d4ed8;
}
.header-notice__text{
  margin:0;
  font-size:.88rem;
  line-height:1.5;
  color:#475569;
}
.header-notice__text strong{
  color:#0f172a;
  font-weight:600;
}
.permission-alert{
  border-radius:14px;
}
.empty-state{
  max-width: 520px;
}

@media (max-width: 640px){
  .page-header__shell{
    padding:18px 16px;
  }
  .page-header__actions{
    width:100%;
  }
  .page-header__actions .v-btn{
    flex:1;
  }
}
</style>

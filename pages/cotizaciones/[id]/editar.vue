<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  doc, getDoc, setDoc, updateDoc, collection, addDoc, serverTimestamp
} from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useUserStore } from '~/stores/user'
import CotizacionForm from '~/components/CotizacionForm.vue'

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

const isVanessaOrAdmin = computed(() => {
  const r = (user.rol || '').toLowerCase()
  return r === 'admin' || r.includes('vanes')
})
const isOwner = computed(() => {
  const vendedorUid = cot.value?.vendedor?.uid || cot.value?.vendedorUid
  return Boolean(user.uid && vendedorUid && user.uid === vendedorUid)
})
const canEdit = computed(() => isVanessaOrAdmin.value || isOwner.value)

function fmtWorkflow(w?: string) {
  const map: Record<string, string> = {
    en_revision: 'En revisión',
    consultando: 'Consultando',
    espera_cliente: 'Espera cliente',
    cotizado: 'Cotizada',
  }
  return map[(w || '').toLowerCase()] || w || '—'
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

async function onSubmit(payload: any) {
  const data = payload?.data
  const attachments: File[] = Array.isArray(payload?.attachments) ? payload.attachments : []

  if (!cot.value) return
  if (!canEdit.value) {
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
        stockDisponible: cot.value.stockDisponible,
        licitacion: cot.value.licitacion,
        clienteFinal: cot.value.clienteFinal || null,
        comentariosCliente: cot.value.comentariosCliente || null,
        formaPagoSolicitada: cot.value.formaPagoSolicitada || null,
        formaPagoActual: cot.value.formaPagoActual || null,
        plazoEntrega: cot.value.plazoEntrega || null,
        lugarEntrega: cot.value.lugarEntrega || null,
        comentarioStock: cot.value.comentarioStock || null,
        compradoAntes: (cot.value.compradoAntes ?? false),
        precioAnterior: (cot.value.precioAnterior ?? null),
        fechaDecision: (cot.value.fechaDecision ?? null),
        estado: cot.value.estado,
        workflow: cot.value.workflow || null,
        version: cot.value.version || 1
      })
    })
    await setDoc(doc($db, 'cotizaciones', id.value, 'versiones', String(nextVersion)), snapshotDoc)

    const updatePayload = cleanData({
      cliente: data.cliente,
      tarifa: data.tarifa,
      articulos: data.articulos,
      stockDisponible: data.stockDisponible,
      licitacion: data.licitacion,
      clienteFinal: data.clienteFinal || null,
      comentariosCliente: data.comentariosCliente || null,
      formaPagoActual: data.formaPagoActual || null,
      plazoEntrega: data.plazoEntrega || null,
      lugarEntrega: data.lugarEntrega || null,
      comentarioStock: data.comentarioStock || null,
      compradoAntes: data.compradoAntes,
      precioAnterior: (data.precioAnterior ?? null),
      fechaDecision: (data.fechaDecision ?? null),
      estado: 'reabierta',
      workflow: 'en_revision',
      version: nextVersion,
      updatedAt: now
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
      texto: 'El comercial ha editado la cotización. Se reabre para revisión.'
    })

    await navigateTo(detailUrl.value)
  } catch (e:any) {
    console.error('[EDIT] error guardando', e)
    errorMsg.value = e?.message || 'Error guardando cambios'
  } finally {
    saving.value = false
  }
}

onMounted(load)
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
              <span class="breadcrumb-current">Editar</span>
            </nav>

            <div class="page-header__shell">
              <div class="page-header__row">
                <div class="page-header__identity">
                  <div class="page-header__avatar">
                    <Icon name="mdi:file-document-edit-outline" />
                  </div>
                  <div class="page-header__copy">
                    <p class="page-header__eyebrow">Edición de cotización</p>
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
                  Tarifa {{ cot.tarifa || '—' }}
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
                    <Icon name="mdi:lock-outline" />
                  </span>
                  <p class="header-notice__text">
                    Los artículos originales están bloqueados. Puedes ajustar precios solicitados,
                    añadir líneas nuevas o actualizar la información complementaria.
                  </p>
                </div>
              </div>
            </div>
          </header>

          <v-alert v-if="!canEdit" type="warning" variant="tonal" class="mb-4 permission-alert">
            No tienes permisos para editar esta cotización (solo el comercial asignado o Vanessa/Admin).
          </v-alert>

          <ClientOnly>
            <CotizacionForm
              mode="edit"
              :initial="cot"
              :loading="saving"
              :detail-url="detailUrl"
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

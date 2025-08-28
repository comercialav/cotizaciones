<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  doc, getDoc, setDoc, updateDoc, collection, addDoc, serverTimestamp
} from 'firebase/firestore'
import { useUserStore } from '~/stores/user'
import CotizacionForm from '~/components/CotizacionForm.vue'

const { $db } = useNuxtApp()
const route = useRoute()
const user = useUserStore()

definePageMeta({
  middleware: ['role-comercial']
})

const id = computed(() => String(route.params.id))

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
    console.error('[editar] error cargando', e)
    errorMsg.value = 'No se pudo cargar la cotización.'
  } finally {
    loading.value = false
  }
}

function cleanData(obj: any) {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined)
  )
}

async function onSubmit(payload: any) {
  const data = JSON.parse(JSON.stringify(payload))
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

    // 1) Guardar snapshot en subcolección "versiones"
    await setDoc(
      doc($db, 'cotizaciones', id.value, 'versiones', String(nextVersion)),
      cleanData({
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
          plazoEntrega: cot.value.plazoEntrega || null,
          lugarEntrega: cot.value.lugarEntrega || null,
          comentarioStock: cot.value.comentarioStock || null,
          estado: cot.value.estado,
          workflow: cot.value.workflow || null,
          version: cot.value.version || 1
        })
      })
    )

    // 2) Actualizar principal
    await updateDoc(doc($db, 'cotizaciones', id.value), cleanData({
      cliente: payload.cliente,
      tarifa: payload.tarifa,
      articulos: payload.articulos,
      stockDisponible: payload.stockDisponible,
      licitacion: payload.licitacion,
      clienteFinal: payload.clienteFinal || null,
      comentariosCliente: payload.comentariosCliente || null,
      formaPagoSolicitada: payload.formaPagoSolicitada || null,
      plazoEntrega: payload.plazoEntrega || null,
      lugarEntrega: payload.lugarEntrega || null,
      comentarioStock: payload.comentarioStock || null,
      estado: 'reabierta',
      workflow: 'en_revision',
      version: nextVersion,
      updatedAt: now
    }))

    // 3) Añadir comentario de actividad
    await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
      fecha: now,
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol },
      texto: 'El comercial ha editado la cotización. Se reabre para revisión.'
    })

    // 4) Redirigir al detalle
    await navigateTo(`/cotizaciones/${id.value}`)
  } catch (e:any) {
    console.error('[editar] error guardando', e)
    errorMsg.value = e?.message || 'Error guardando cambios'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <v-container class="py-6">
    <v-skeleton-loader
      v-if="loading"
      :type="['article', 'card', 'table', 'actions']"
    />

    <template v-else>
      <div v-if="!cot">
        <v-alert type="error" variant="tonal" class="mb-4">
          No existe esta cotización.
        </v-alert>
        <v-btn color="primary" @click="navigateTo('/cotizaciones')">
          <template #prepend><Icon name="mdi:arrow-left" class="me-2" /></template>
          Volver al listado
        </v-btn>
      </div>

      <template v-else>
        <!-- Cabecera -->
        <v-card class="mb-4 pa-4">
          <div class="d-flex justify-space-between align-center">
            <h2 class="text-h6 font-weight-bold">Editar cotización – {{ cot.cliente }}</h2>
            <div class="d-flex align-center ga-2">
              <v-chip color="primary" variant="tonal" size="small">
                Versión {{ (cot.version || 1) }}
              </v-chip>
              <v-btn variant="text" @click="navigateTo(`/cotizaciones/${cot.id}`)">
                <template #prepend><Icon name="mdi:open-in-new" class="me-2" /></template>
                Ver detalle
              </v-btn>
            </div>
          </div>
          <div class="text-medium-emphasis mt-1">
            Al guardar, la cotización se marcará como <strong>reabierta</strong> y pasará a <strong>En revisión</strong>.
          </div>
        </v-card>

        <v-alert v-if="!canEdit" type="warning" variant="tonal" class="mb-4">
          No tienes permisos para editar esta cotización (solo el comercial asignado o Vanessa/Admin).
        </v-alert>

        <div class="form-wrapper">
          <ClientOnly>
            <CotizacionForm
              :mode="'edit'"
              :initial="cot"
              @submit="onSubmit"
            />
          </ClientOnly>

          <v-alert v-if="errorMsg" type="error" variant="tonal" class="mt-3">
            {{ errorMsg }}
          </v-alert>

          <div class="d-flex justify-end ga-3 mt-4">
            <v-btn variant="text" :disabled="saving" @click="navigateTo(`/cotizaciones/${cot.id}`)">
              Cancelar
            </v-btn>
          </div>
        </div>
      </template>
    </template>
  </v-container>
</template>

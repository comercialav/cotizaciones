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
  console.group('[EDIT] load')
  try {
    loading.value = true
    const snap = await getDoc(doc($db, 'cotizaciones', id.value))
    if (!snap.exists()) {
      cot.value = null
      console.warn('[EDIT] no existe doc', id.value)
      return
    }
    cot.value = { id: snap.id, ...snap.data() }
    console.log('[EDIT] doc cargado:', cot.value)
    console.log('[EDIT] canEdit?', canEdit.value, 'isOwner?', isOwner.value, 'role:', user.rol)
  } catch (e) {
    console.error('[EDIT] error cargando', e)
    errorMsg.value = 'No se pudo cargar la cotización.'
  } finally {
    loading.value = false
    console.groupEnd()
  }
}

function cleanData(obj: any) {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined))
}

async function onSubmit(payload: any) {
  console.group('[EDIT] onSubmit')
  console.log('payload recibido:', payload)

  const data = payload?.data
  const attachments: File[] = Array.isArray(payload?.attachments) ? payload.attachments : []
  console.log('desempaquetado -> data:', data, 'attachments:', attachments.map(f=>f.name))

  if (!cot.value) { console.warn('! cot vacío'); console.groupEnd(); return }
  if (!canEdit.value) {
    errorMsg.value = 'No tienes permisos para editar esta cotización.'
    console.warn('! sin permisos')
    console.groupEnd()
    return
  }

  saving.value = true
  errorMsg.value = ''
  try {
    const now = serverTimestamp()
    const currentVersion = Number(cot.value.version || 1)
    const nextVersion = currentVersion + 1

    // 1) Snapshot versión
    console.group('[EDIT] snapshot versión')
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
    console.log('snapshot payload:', snapshotDoc)
    await setDoc(doc($db, 'cotizaciones', id.value, 'versiones', String(nextVersion)), snapshotDoc)
    console.log('✓ snapshot guardado como versión', nextVersion)
    console.groupEnd()

    // 2) Update principal
    console.group('[EDIT] update principal')
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
    console.log('update payload:', updatePayload)
    await updateDoc(doc($db, 'cotizaciones', id.value), updatePayload)
    console.log('✓ principal actualizado')
    console.groupEnd()

    // 3) Subir adjuntos nuevos (si los hay)
    if (attachments.length) {
      console.group('[EDIT] subir adjuntos nuevos')
      await ensureAuth()
      for (const f of attachments) {
        const path = `cotizaciones/${id.value}/adjuntos/${Date.now()}_${f.name}`
        const fileRef = storageRef($storage, path)
        console.log('subiendo:', f.name, '->', path)
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
        console.log('✓ adjunto registrado:', f.name)
      }
      console.groupEnd()
    } else {
      console.log('[EDIT] sin adjuntos nuevos')
    }

    // 4) Comentario actividad
    await addDoc(collection($db, 'cotizaciones', id.value, 'comentarios'), {
      fecha: now,
      author: { uid: user.uid, nombre: user.nombre, rol: user.rol },
      texto: 'El comercial ha editado la cotización. Se reabre para revisión.'
    })
    console.log('✓ comentario de actividad añadido')

    // 5) Redirigir
    console.groupEnd()
    await navigateTo(`/cotizaciones/${id.value}`)
  } catch (e:any) {
    console.error('[EDIT] error guardando', e)
    errorMsg.value = e?.message || 'Error guardando cambios'
    console.groupEnd()
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

<script setup lang="ts">
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { useCotizacionesStore } from '~/stores/cotizaciones'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useUserStore } from '~/stores/user'

const cot = useCotizacionesStore()
const user = useUserStore()
const { $db, $storage, $auth } = useNuxtApp()

// asegúrate de tener sesión para firmar las subidas al Storage
async function ensureAuth() {
  if ($auth.currentUser) return
  const { signInAnonymously } = await import('firebase/auth')
  await signInAnonymously($auth)
}

async function guardarNueva(payload:any){
  console.log('[NUEVA] payload @submit:', payload)

  const datosForm = payload?.data ?? payload
  const files: File[] = Array.isArray(payload?.attachments)
    ? payload.attachments
    : Array.isArray(payload?._adjuntosFiles) ? payload._adjuntosFiles : []

  console.log('[NUEVA] datosForm:', JSON.parse(JSON.stringify(datosForm)))
  console.log('[NUEVA] files:', files?.map?.(f => ({ name: f.name, size: f.size, type: f.type })) ?? [])

  const cliente = (datosForm?.cliente ?? '').trim()
  const tarifa  = (datosForm?.tarifa ?? '').trim()
  console.log('[NUEVA] cliente/tarifa:', { cliente, tarifa })

  if (!cliente || !tarifa) { console.warn('[NUEVA] Falta cliente/tarifa'); return }

  // sanity sobre líneas de artículos
  const articulosClean = (datosForm.articulos || []).map((a:any) => {
  const r:any = {
      articulo: (a.articulo || '').trim(),
      url: (a.url || '').trim(),
      unidades: Number(a.unidades || 0),
      precioCliente: Number(a.precioCliente || 0),
    }
    if (a.precioSolicitado != null)   r.precioSolicitado   = Number(a.precioSolicitado)
    if (a.precioCompetencia != null) r.precioCompetencia = Number(a.precioCompetencia)
    return r
  })

  const { id } = await cot.crearCotizacion({
    cliente,
    tarifa,
    articulos: articulosClean,
    stockDisponible: datosForm.stockDisponible ?? true,
    compradoAntes: !!datosForm.compradoAntes,
    precioAnterior: datosForm.precioAnterior ?? null,
    fechaDecision: datosForm.fechaDecision ?? null,
    plazoEntrega: datosForm.plazoEntrega || '',
    lugarEntrega: datosForm.lugarEntrega || '',
    comentarioStock: datosForm.comentarioStock || '',
    licitacion: !!datosForm.licitacion,
    clienteFinal: datosForm.clienteFinal || '',
    precioCompet: datosForm.precioCompet ?? null,
    comentarios: datosForm.comentariosCliente || '',
    formaPagoSolicitada: datosForm.formaPagoSolicitada || '',
  })

  if (id && files.length) {
    await ensureAuth()
    for (const f of files) {
      const path = `cotizaciones/${id}/adjuntos/${Date.now()}_${f.name}`
      const fileRef = storageRef($storage, path)
      await uploadBytes(fileRef, f)
      const url = await getDownloadURL(fileRef)
      await addDoc(collection($db, 'cotizaciones', id, 'adjuntos'), {
        nombre: f.name,
        url,
        tipo: f.type || null,
        size: f.size || null,
        createdAt: serverTimestamp(),
        author: { uid: user.uid, nombre: user.nombre, rol: user.rol }
      })
    }
  }

  navigateTo('/cotizaciones')
}

</script>

<template>
  <div class="page-bg">
    <v-container class="py-8">
      <div class="mb-6 flex items-center gap-3">
        <Icon name="mdi:clipboard-text-outline" class="text-2xl text-primary" />
        <h1 class="text-2xl font-bold">Nueva Solicitud de Cotización</h1>
      </div>

      <!-- Asegúrate de que el componente CotizacionForm emita también `_adjuntosFiles` si el usuario sube ficheros -->
      <CotizacionForm @submit="guardarNueva" />
    </v-container>
  </div>
</template>

<style scoped>
.page-bg{
  min-height: 100vh;
  background:
    radial-gradient(1200px 600px at 80% 20%, rgba(25,118,210,0.10), transparent 60%),
    radial-gradient(900px 500px at 10% 80%, rgba(0,214,255,0.10), transparent 60%),
    linear-gradient(180deg, #f7fbff, #f1f5ff);
}
</style>

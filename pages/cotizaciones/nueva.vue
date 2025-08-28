<script setup lang="ts">
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'

async function guardarNueva(data: any) {
  try {
    const { $db } = useNuxtApp()   // <-- aquí recoges lo que inyectaste
    await addDoc(collection($db, 'cotizaciones'), {
      ...data,
      estado: 'pendiente',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    navigateTo('/cotizaciones')
  } catch (err) {
    console.error('Error guardando cotización:', err)
  }
}

</script>

<template>
  <div class="page-bg">
    <v-container class="py-8">
      <div class="mb-6 flex items-center gap-3">
        <Icon name="mdi:clipboard-text-outline" class="text-2xl text-primary" />
        <h1 class="text-2xl font-bold">Nueva Solicitud de Cotización</h1>
      </div>

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

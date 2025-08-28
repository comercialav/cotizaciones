<script setup lang="ts">
const {$db, $auth} = useNuxtApp()

import { collection, getDocs } from "firebase/firestore"
import { onAuthStateChanged } from "firebase/auth"

const message = ref("Probando conexión Firebase...")

// Test Firestore
onMounted(async () => {
  try {
    // intenta leer una colección ficticia "test"
    const snapshot = await getDocs(collection($db, "test"))
    message.value = `Firestore conectado ✅ (${snapshot.size} docs en colección 'test')`
  } catch (err) {
    message.value = "❌ Error al conectar Firestore: " + err
  }
})

// Test Auth
onMounted(() => {
  onAuthStateChanged($auth, (user) => {
    if (user) {
      console.log("Usuario logueado:", user.email)
    } else {
      console.log("No hay usuario autenticado")
    }
  })
})
</script>

<template>
  <div>
    <h1>{{ message }}</h1>
  </div>
</template>

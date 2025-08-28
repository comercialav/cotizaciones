<template>
  <v-app>
    <!-- Navbar de la app (ocúltalo en /login si quieres) -->
    <Navbar v-if="route.name !== 'login'" />

    <!-- Contenido de cada page -->
    <v-main>
      <slot />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
const route = useRoute()
</script>
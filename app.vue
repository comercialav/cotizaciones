<script setup lang="ts">
import { useUserStore } from "~/stores/user"

const user = useUserStore()
</script>

<template>
  <div>
    <div v-if="user.loading" class="splash-loader">
      <div class="loader-circle">
        <img src="/logo.png" alt="Logo Comercial AV" class="logo" />
      </div>
    </div>

    <!-- App normal -->
    <NuxtLayout v-else>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>


<style scoped>
.splash-loader {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #D2EEFF; /* color de fondo oscuro tipo videojuego */
  position: fixed;
  inset: 0;
  z-index: 9999;
}

/* Contenedor con logo y círculo */
.loader-circle {
  position: relative;
  width: 160px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo {
  width: 80px;
  height: auto;
  z-index: 2;
}

/* Círculo animado (halo tipo cometa) */
.loader-circle::before {
  content: "";
  position: absolute;
  width: 160px;
  height: 160px;
  border-radius: 50%;
  border: 4px solid transparent;
  border-top-color: #10a2f4; /* azul neón */
  border-right-color: #0287de; /* azul más oscuro para efecto degradado */
  animation: spin 1.2s linear infinite;
  box-shadow: 0 0 20px rgba(0, 229, 255, 0.7);
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>

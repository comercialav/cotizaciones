<template>
  <v-app>
   <v-main class="login-main">
    <slot />
    </v-main>
  </v-app>
</template>

<style lang="css" scoped>
.login-main {
  padding-top: 0 !important;
  min-height: 100vh; /* ocupa toda la pantalla */
}
</style>
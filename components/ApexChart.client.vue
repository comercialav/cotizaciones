<script setup lang="ts">
// Solo cliente: ApexCharts necesita `window` (rompe SSR si se importa en páginas)
import VueApexCharts from 'vue3-apexcharts'
</script>

<template>
  <VueApexCharts />
</template>

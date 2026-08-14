<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useUserStore } from '~/stores/user'
import { useAppConfigStore } from '~/stores/app-config'

definePageMeta({ middleware: ['role-admin'] })

const user = useUserStore()
const appConfig = useAppConfigStore()
const snackbar = ref(false)
const snackbarText = ref('')

onMounted(() => {
  void appConfig.load(true)
})

async function save() {
  try {
    await appConfig.save(user)
    snackbarText.value = 'Ajustes guardados'
    snackbar.value = true
  } catch {
    snackbarText.value = appConfig.error || 'Error al guardar'
    snackbar.value = true
  }
}
</script>

<template>
  <v-container class="py-6" max-width="720">
    <header class="mb-6">
      <p class="text-overline text-medium-emphasis mb-1">Administración</p>
      <h1 class="text-h5 font-weight-bold mb-1">Ajustes</h1>
      <p class="text-medium-emphasis mb-0">
        Activa o desactiva funciones especiales de la app.
      </p>
    </header>

    <v-skeleton-loader v-if="appConfig.loading && !appConfig.loaded" type="article" />

    <template v-else>
      <v-alert v-if="appConfig.error" type="error" variant="tonal" class="mb-4">
        {{ appConfig.error }}
      </v-alert>

      <v-card variant="outlined" rounded="lg" class="pa-5">
        <div class="d-flex align-start justify-space-between ga-4 flex-wrap">
          <div class="flex-grow-1" style="min-width: 220px">
            <h2 class="text-subtitle-1 font-weight-bold mb-1">Compras sustituye a supervisora</h2>
            <p class="text-body-2 text-medium-emphasis mb-0">
              Cuando la supervisora no está (vacaciones, baja…), activa esto para que
              <strong>compras</strong> pueda cotizar, recotizar, editar el precio cotizado
              y gestionar participantes.
              Desactívalo al volver a la operativa normal.
            </p>
          </div>
          <v-switch
            v-model="appConfig.config.comprasPuedeCotizar"
            color="primary"
            inset
            hide-details
            :disabled="appConfig.saving"
            class="flex-shrink-0"
          />
        </div>

        <v-alert
          class="mt-4 mb-0"
          density="comfortable"
          variant="tonal"
          :type="appConfig.config.comprasPuedeCotizar ? 'warning' : 'info'"
        >
          <template v-if="appConfig.config.comprasPuedeCotizar">
            Ahora mismo compras <strong>sí</strong> puede cotizar y gestionar participantes.
          </template>
          <template v-else>
            Ahora mismo solo la supervisora (y admin) puede cotizar y gestionar participantes.
          </template>
        </v-alert>

        <div class="d-flex justify-end mt-5">
          <v-btn
            color="primary"
            :loading="appConfig.saving"
            :disabled="appConfig.loading"
            @click="save"
          >
            <template #prepend><Icon name="mdi:content-save" /></template>
            Guardar
          </v-btn>
        </div>
      </v-card>
    </template>

    <v-snackbar v-model="snackbar" :timeout="2500" color="primary">
      {{ snackbarText }}
    </v-snackbar>
  </v-container>
</template>

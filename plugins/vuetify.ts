// plugins/vuetify.ts
import { defineNuxtPlugin } from '#app'
import { createVuetify } from 'vuetify'

export default defineNuxtPlugin(({ vueApp }) => {
  // Componentes vía vite-plugin-vuetify (autoImport + labs), sin import * masivo
  const vuetify = createVuetify({
    theme: { defaultTheme: 'light' },
  })
  vueApp.use(vuetify)
})

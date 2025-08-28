// plugins/vuetify.ts
import { defineNuxtPlugin } from '#app'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { VIconBtn } from 'vuetify/labs/VIconBtn'

export default defineNuxtPlugin(({ vueApp }) => {
  const vuetify = createVuetify({
    components: {
      VIconBtn,
      ...components,
    },
    directives,
    theme: { defaultTheme: 'light' }
    
  })
  vueApp.use(vuetify)
})

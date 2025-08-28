// https://nuxt.com/docs/api/configuration/nuxt-config
import vuetify from 'vite-plugin-vuetify';
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  modules: [
    '@nuxt/icon',
    '@pinia/nuxt'
  ],
  css: [
    'vuetify/styles',
  ],
   // Configuración de Vite para que Vuetify funcione en SSR
   vite: {
    ssr: { noExternal: ['vuetify'] },
    plugins: [ vuetify() ]
  },
  runtimeConfig: {
    mailHost: process.env.MAIL_HOST || "smtp.ionos.es",
    mailPort: process.env.MAIL_PORT || "465",
    mailUser: process.env.MAIL_USER || "cotizaciones@comercialav.com",
    mailPass: process.env.MAIL_PASS || "8S#kfaT@F&hMW",
    mailFrom: process.env.MAIL_FROM || "cotizaciones@comercialav.com",
    mailSecure: "true", // true en 465, false en 587
    public: {
      firebaseApiKey: process.env.FIREBASE_API_KEY || '',
      firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
      firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
      firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      firebaseAppId: process.env.FIREBASE_APP_ID || ''
    }
  }
})
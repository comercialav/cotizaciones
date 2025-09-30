// nuxt.config.ts
import vuetify from 'vite-plugin-vuetify'

export default defineNuxtConfig({
  ssr: true,
  nitro: { preset: 'node-server' },

  modules: ['@nuxt/icon', '@pinia/nuxt'],
  css: ['vuetify/styles'],

  build: {
    transpile: ['vuetify'],              // ← importante
  },
  vite: {
    ssr: { noExternal: ['vuetify'] },    // ← importante
    plugins: [vuetify({ autoImport: true })], // ← importante
  },

  app: {
    head: {
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },

  runtimeConfig: {
    // Privadas (solo server)
    mailHost: process.env.MAIL_HOST,
    mailPort: process.env.MAIL_PORT ?? '465',
    mailUser: process.env.MAIL_USER,
    mailPass: process.env.MAIL_PASS,
    mailFrom: process.env.MAIL_FROM ?? process.env.MAIL_USER,
    mailSecure: 'true',
    slackToken: process.env.SLACK_BOT_TOKEN,

    // Públicas (cliente)
    public: {
      firebaseApiKey: process.env.FIREBASE_API_KEY || '',
      firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
      firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
      firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      firebaseAppId: process.env.FIREBASE_APP_ID || '',
      algoliaAppId: process.env.NUXT_PUBLIC_ALGOLIA_APP_ID,
      algoliaSearchKey: process.env.NUXT_PUBLIC_ALGOLIA_SEARCH_KEY,
      algoliaIndex: process.env.NUXT_PUBLIC_ALGOLIA_INDEX_NAME
    },
  },
})

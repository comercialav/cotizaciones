import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig().public

  // Inicializamos la app de Firebase con las variables de entorno
  const firebaseApp = initializeApp({
    apiKey: config.firebaseApiKey,
    authDomain: config.firebaseAuthDomain,
    projectId: config.firebaseProjectId,
    storageBucket: config.firebaseStorageBucket,
    messagingSenderId: config.firebaseMessagingSenderId,
    appId: config.firebaseAppId,
  })

  // Servicios que usaremos
  const auth = getAuth(firebaseApp)
  const db = getFirestore(firebaseApp)
  const funcs = getFunctions(firebaseApp)

  // Los inyectamos para usarlos en componentes/composables
  nuxtApp.provide('auth', auth)
  nuxtApp.provide('db', db)
  nuxtApp.provide('funcs', funcs)
})

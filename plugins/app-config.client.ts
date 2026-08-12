import { useAppConfigStore } from '~/stores/app-config'
import { useUserStore } from '~/stores/user'

/**
 * Carga la config de la app (flags de admin) cuando hay sesión con email.
 */
export default defineNuxtPlugin(() => {
  if (!process.client) return

  const user = useUserStore()
  const appConfig = useAppConfigStore()

  watch(
    () => [user.email, user.authInitialized] as const,
    ([email, ready]) => {
      if (!ready || !email) return
      void appConfig.load()
    },
    { immediate: true },
  )
})

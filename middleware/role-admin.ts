import { watch } from 'vue'
import { useUserStore } from '~/stores/user'

export default defineNuxtRouteMiddleware(async () => {
  if (process.server) return
  const user = useUserStore()

  if (user.loading && !user.authInitialized) {
    await new Promise<void>((resolve) => {
      const stop = watch(
        () => user.loading,
        (v) => { if (!v) { stop(); resolve() } },
        { immediate: true }
      )
    })
  }

  const role = (user.rol || '').toLowerCase()
  const allowed =
    role === 'admin' ||
    role === 'jefe_comercial' ||
    role.includes('vanes') ||
    user.esSupervisor === true

  if (!user.isAuthenticated || !allowed) {
    return navigateTo('/')
  }
})

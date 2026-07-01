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
  const email = (user.email || '').toLowerCase()
  const cfg = useRuntimeConfig().public
  const adminEmails = String(cfg.adminEmails || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

  const allowed = role === 'admin' || adminEmails.includes(email)

  if (!user.isAuthenticated || !allowed) {
    return navigateTo('/')
  }
})

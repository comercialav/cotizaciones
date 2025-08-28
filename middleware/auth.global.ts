// filepath: middleware/auth.global.ts
import { watch } from "vue"
import { useUserStore } from "~/stores/user"

export default defineNuxtRouteMiddleware(async (to, from) => {
  // En SSR no podemos resolver Auth de Firebase; controlamos en cliente
  if (process.server) return

  const userStore = useUserStore()

  console.log("[middleware] →", from.fullPath, "→", to.fullPath, 
              "| loading:", userStore.loading, "uid:", userStore.uid)

  // Espera activa a que termine initUser() la 1ª vez
  if (userStore.loading) {
    await new Promise<void>((resolve) => {
      const stop = watch(
        () => userStore.loading,
        (isLoading) => {
          if (!isLoading) {
            stop()
            resolve()
          }
        },
        { immediate: true }
      )
    })
  }

  console.log("[middleware] listo | uid:", userStore.uid, "path:", to.path)

  // Redirecciones
  if (!userStore.uid && to.path !== "/login") {
    console.log("[middleware] sin sesión → /login")
    return navigateTo("/login")
  }
  if (userStore.uid && to.path === "/login") {
    console.log("[middleware] con sesión en /login → /")
    return navigateTo("/")
  }
})

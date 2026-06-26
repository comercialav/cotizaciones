// filepath: middleware/auth.global.ts
import { watch } from "vue"
import { useUserStore } from "~/stores/user"

export default defineNuxtRouteMiddleware(async (to, from) => {
  // En SSR no podemos resolver Auth de Firebase; controlamos en cliente
  if (process.server) return

  const userStore = useUserStore()

  console.log("[middleware] →", from.fullPath, "→", to.fullPath, 
              "| loading:", userStore.loading, "uid:", userStore.uid)

  // Espera activa solo al arranque inicial de la app
  if (userStore.loading && !userStore.authInitialized) {
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

  // Redirecciones (email = usuario real; uid anónimo no cuenta como sesión)
  if (!userStore.isAuthenticated && to.path !== "/login") {
    console.log("[middleware] sin sesión → /login")
    return navigateTo("/login")
  }
  if (userStore.isAuthenticated && to.path === "/login") {
    console.log("[middleware] con sesión en /login → /")
    return navigateTo("/")
  }
})

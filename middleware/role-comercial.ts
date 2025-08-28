import { watch } from "vue"
import { useUserStore } from "~/stores/user"

export default defineNuxtRouteMiddleware(async () => {
  if (process.server) return
  const user = useUserStore()

  // Espera a que el store termine de cargar
  if (user.loading) {
    await new Promise<void>((resolve) => {
      const stop = watch(() => user.loading, (v) => { if (!v) { stop(); resolve() } }, { immediate: true })
    })
  }

  const role = (user.rol || "").toLowerCase()

  // ✅ ahora permitimos comercial, admin y jefe_comercial (y alias "vanessa")
  const allowed =
    role === "comercial" ||
    role === "admin" ||
    role === "jefe_comercial" ||
    role.includes("vanes")

  if (!user.uid || !allowed) {
    return navigateTo("/")
  }
})

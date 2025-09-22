// stores/user.ts
import { defineStore } from "pinia"
import type { User } from "firebase/auth"
import { onAuthStateChanged, signInAnonymously } from "firebase/auth"
import { collection, query, where, getDocs, limit } from "firebase/firestore"

type Role = "comercial" | "jefe_comercial" | "compras" | "admin"

interface UserState {
  uid: string | null
  email: string | null
  nombre: string | null
  rol: Role | null
  esSupervisor: boolean | null
  loading: boolean
}

function normalizeRole(r: any): Role {
  const s = String(r ?? "").toLowerCase()
  if (s === "vanessa" || s === "jefe_comercial") return "jefe_comercial"
  if (s === "compras" || s === "admin") return s as Role
  return "comercial"
}

export const useUserStore = defineStore("user", {
  state: (): UserState => ({
    uid: null,
    email: null,
    nombre: null,
    rol: null,
    esSupervisor: null,
    loading: true,
  }),

  actions: {
    async initUser(): Promise<void> {
      // Usa instancias del plugin (evita apps duplicadas)
      const { $auth, $db } = useNuxtApp()
      this.loading = true

      await new Promise<void>((resolve) => {
        let resolved = false

        onAuthStateChanged($auth, async (u: User | null) => {
          this.loading = true
          try {
            // Si no hay sesión, entra anónimo (necesario para Storage con request.auth != null)
            if (!u) {
              await signInAnonymously($auth)
              u = $auth.currentUser
            }

            this.uid = u?.uid ?? null
            this.email = u?.email ?? null

            // Usuarios anónimos no tienen email → deja perfil vacío
            const emailRaw = (u?.email || u?.providerData?.[0]?.email || "").trim()
            if (!emailRaw) {
              this.nombre = null
              this.rol = null
              this.esSupervisor = null
              return
            }

            const emailLower = emailRaw.toLowerCase()

            // Busca perfil en 'usuarios' por emailLower y, si no, por email
            let snap = await getDocs(
              query(collection($db, "usuarios"), where("emailLower", "==", emailLower), limit(1))
            )
            if (snap.empty) {
              snap = await getDocs(
                query(collection($db, "usuarios"), where("email", "==", emailRaw), limit(1))
              )
            }

            if (!snap.empty) {
              const data: any = snap.docs[0].data()
              this.nombre = data.nombre || u?.displayName || emailRaw
              this.rol = normalizeRole(data.rol)
              this.esSupervisor = Boolean(data.esSupervisor)
              console.log("[userStore] Perfil cargado:", {
                email: data.email,
                rol: this.rol,
                esSupervisor: this.esSupervisor,
              })
            } else {
              console.warn("[userStore] Sin perfil en 'usuarios' para:", emailRaw)
              this.nombre = u?.displayName || null
              this.rol = null
              this.esSupervisor = null
            }
          } catch (e) {
            console.error("[userStore] Error initUser:", e)
          } finally {
            this.loading = false
            if (!resolved) {
              resolved = true
              resolve()
            }
          }
        }, (err) => {
          console.error("[userStore] onAuthStateChanged error:", err)
          this.loading = false
          if (!resolved) {
            resolved = true
            resolve()
          }
        })
      })
    },

    logout() {
      const { $auth } = useNuxtApp()
      return $auth.signOut()
    },
  },
})

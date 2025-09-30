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

  getters: {
    isSupervisor(state): boolean {
      return state.rol === "jefe_comercial" || state.rol === "admin" || state.esSupervisor === true
    },
    isCompras(state): boolean {
      const mail = state.email?.toLowerCase() || ""
      return state.rol === "compras" || mail === "compras@comercialav.com"
    },
    canEditarCoste(): boolean {
      return this.isSupervisor || this.isCompras
    },
    canAñadirArticulo(): boolean {
      return this.isSupervisor || this.isCompras
    },
  },

  actions: {
    async initUser(): Promise<void> {
      const { $auth, $db } = useNuxtApp()
      this.loading = true

      await new Promise<void>((resolve) => {
        let resolved = false

        onAuthStateChanged($auth, async (u: User | null) => {
          this.loading = true
          try {
            if (!u) {
              await signInAnonymously($auth)
              u = $auth.currentUser
            }

            this.uid = u?.uid ?? null
            this.email = u?.email ?? null

            const emailRaw = (u?.email || u?.providerData?.[0]?.email || "").trim()
            if (!emailRaw) {
              this.nombre = null
              this.rol = null
              this.esSupervisor = null
              return
            }

            const emailLower = emailRaw.toLowerCase()

            // Busca perfil en 'usuarios'
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
              // Si el doc no trae esSupervisor, deriva por rol
              this.esSupervisor = (typeof data.esSupervisor === "boolean")
                ? data.esSupervisor
                : (this.rol === "jefe_comercial" || this.rol === "admin")
            } else {
              // Sin perfil: nombre opcional y rol inicial nulo
              this.nombre = u?.displayName || emailRaw
              this.rol = null
              this.esSupervisor = null
            }

            // Fallback específico para compras por email, sin romper datos existentes
            if (!this.rol && emailLower === "compras@comercialav.com") {
              this.rol = "compras"
              this.esSupervisor = false
            }

            // Normaliza esSupervisor si sigue nulo
            if (this.esSupervisor == null) {
              this.esSupervisor = this.rol === "jefe_comercial" || this.rol === "admin"
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

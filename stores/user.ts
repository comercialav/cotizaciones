// stores/user.ts
import { defineStore } from "pinia"
import type { Auth, User } from "firebase/auth"
import { onAuthStateChanged, signInAnonymously, signOut } from "firebase/auth"
import { collection, query, where, getDocs, limit } from "firebase/firestore"

type Role = "comercial" | "jefe_comercial" | "compras" | "admin"

interface UserState {
  uid: string | null
  email: string | null
  nombre: string | null
  rol: Role | null
  esSupervisor: boolean | null
  activo: boolean
  loading: boolean
  authInitialized: boolean
  skipAnonymousReauth: boolean
  /** UIDs que pueden aparecer en cotizaciones (auth, legacy, doc id) */
  scopeUids: string[]
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
    activo: true,
    loading: true,
    authInitialized: false,
    skipAnonymousReauth: false,
    scopeUids: [],
  }),

  getters: {
    isAuthenticated(state): boolean {
      return !!state.email
    },
    isSupervisor(state): boolean {
      return state.rol === "jefe_comercial" || state.rol === "admin" || state.esSupervisor === true
    },
    isCompras(state): boolean {
      const mail = state.email?.toLowerCase() || ""
      const rol = (state.rol || "").toLowerCase()
      return rol === "compras" || mail === "compras@comercialav.com"
    },
    canEditarCoste(): boolean {
      return this.isSupervisor || this.isCompras
    },
    canAñadirArticulo(): boolean {
      return this.isSupervisor || this.isCompras
    },
    canBorrarCotizacion(): boolean {
      return this.isSupervisor || this.isCompras
    },
    /** Aviso «pendiente de compras» solo para supervisora y compras */
    canVerPendienteCompras(): boolean {
      return this.isSupervisor || this.isCompras
    },
    isAdmin(state): boolean {
      const email = (state.email || '').toLowerCase()
      const cfg = useRuntimeConfig().public
      const admins = String(cfg.adminEmails || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
      return state.rol === 'admin' || admins.includes(email)
    },
    canManageUsers(): boolean {
      return this.isAdmin
    },
  },

  actions: {
    clearProfile() {
      this.uid = null
      this.email = null
      this.nombre = null
      this.rol = null
      this.esSupervisor = null
      this.activo = true
      this.scopeUids = []
    },

    async initUser(): Promise<void> {
      const { $auth, $db } = useNuxtApp()
      this.loading = true

      await new Promise<void>((resolve) => {
        let resolved = false

        onAuthStateChanged($auth, async (u: User | null) => {
          try {
            if (!u) {
              this.clearProfile()
              if (this.skipAnonymousReauth) return
              await signInAnonymously($auth)
              u = $auth.currentUser
            }

            this.uid = u?.uid ?? null
            this.email = u?.email ?? null

            const emailRaw = (u?.email || u?.providerData?.[0]?.email || "").trim()
            if (!emailRaw || u?.isAnonymous) {
              this.nombre = null
              this.rol = null
              this.esSupervisor = null
              return
            }

            this.skipAnonymousReauth = false

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
              const docSnap = snap.docs[0]
              const data: any = docSnap.data()
              this.nombre = data.nombre || u?.displayName || emailRaw
              this.rol = normalizeRole(data.rol)
              this.activo = data.activo !== false
              const scope = new Set<string>()
              if (u?.uid) scope.add(u.uid)
              if (data.authUid) scope.add(String(data.authUid))
              if (data.uid) scope.add(String(data.uid))
              scope.add(docSnap.id)
              this.scopeUids = [...scope].filter(Boolean)
              // Si el doc no trae esSupervisor, deriva por rol
              this.esSupervisor = (typeof data.esSupervisor === "boolean")
                ? data.esSupervisor
                : (this.rol === "jefe_comercial" || this.rol === "admin")

              if (this.activo === false) {
                this.skipAnonymousReauth = true
                await signOut($auth as Auth)
                this.clearProfile()
                if (process.client) {
                  await navigateTo('/login?inactive=1')
                }
                return
              }
            } else {
              // Sin perfil: nombre opcional y rol inicial nulo
              this.nombre = u?.displayName || emailRaw
              this.rol = null
              this.esSupervisor = null
              this.scopeUids = u?.uid ? [u.uid] : []
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
            if (!this.authInitialized) {
              this.loading = false
              this.authInitialized = true
            }
            if (!resolved) {
              resolved = true
              resolve()
            }
          }
        }, (err) => {
          console.error("[userStore] onAuthStateChanged error:", err)
          if (!this.authInitialized) {
            this.loading = false
            this.authInitialized = true
          }
          if (!resolved) {
            resolved = true
            resolve()
          }
        })
      })
    },

    async logout() {
      const { $auth } = useNuxtApp()
      this.skipAnonymousReauth = true
      this.clearProfile()
      await signOut($auth as Auth)
    },
  },
})

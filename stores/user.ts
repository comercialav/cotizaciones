// stores/user.ts
import { defineStore } from "pinia"
import { getAuth, onAuthStateChanged } from "firebase/auth"
import {
  getFirestore, collection, query, where, getDocs, limit
} from "firebase/firestore"
import type { User } from "firebase/auth"

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
    loading: true
  }),

  actions: {
    async initUser() {
      const auth = getAuth()
      const db = getFirestore()

      onAuthStateChanged(auth, async (u: User | null) => {
        this.loading = true
        try {
          if (!u) {
            // sin sesión
            this.uid = this.email = this.nombre = null
            this.rol = null
            this.esSupervisor = null
            return
          }

          this.uid = u.uid
          this.email = u.email

          const emailRaw =
            (u.email || u.providerData?.[0]?.email || "").trim()
          const emailLower = emailRaw.toLowerCase()

          if (!emailRaw) {
            console.warn("[userStore] Usuario autenticado sin email.")
            return
          }

          // ---- 1) Intentar por emailLower
          let snap = await getDocs(
            query(
              collection(db, "usuarios"),
              where("emailLower", "==", emailLower),
              limit(1)
            )
          )

          // ---- 2) Fallback por email (según tu estructura actual)
          if (snap.empty) {
            snap = await getDocs(
              query(
                collection(db, "usuarios"),
                where("email", "==", emailRaw),
                limit(1)
              )
            )
          }

          if (!snap.empty) {
            const data = snap.docs[0].data() as any
            this.nombre = data.nombre || u.displayName || emailRaw || "Sin nombre"
            this.rol = normalizeRole(data.rol)
            this.esSupervisor = Boolean(data.esSupervisor)
            console.log("[userStore] Perfil cargado:", {
              email: data.email,
              rol: this.rol,
              esSupervisor: this.esSupervisor
            })
          } else {
            console.warn("[userStore] No existe usuario con ese email en 'usuarios'.")
            // No creamos nada. El estado queda con uid/email y sin perfil.
            this.nombre = null
            this.rol = null
            this.esSupervisor = null
          }
        } catch (e) {
          console.error("[userStore] Error cargando perfil:", e)
          // No mutamos nada más; la app puede decidir qué hacer.
        } finally {
          this.loading = false
        }
      })
    },

    logout() {
      return getAuth().signOut()
    }
  }
})

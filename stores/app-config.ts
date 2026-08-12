import { defineStore } from 'pinia'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { defaultAppConfig, mergeAppConfig, type AppConfig } from '~/utils/app-config'

const DOC_PATH = ['config', 'app'] as const

export const useAppConfigStore = defineStore('app-config', {
  state: () => ({
    config: defaultAppConfig() as AppConfig,
    loading: false,
    saving: false,
    loaded: false,
    error: null as string | null,
    savedAt: null as Date | null,
  }),

  getters: {
    comprasPuedeCotizar(state): boolean {
      return state.config.comprasPuedeCotizar === true
    },
  },

  actions: {
    applyConfig(raw: Partial<AppConfig> | null | undefined) {
      this.config = mergeAppConfig(raw)
    },

    async load(force = false) {
      if (this.loaded && !force) return
      if (!process.client) return
      const { $db } = useNuxtApp()
      this.loading = true
      this.error = null
      try {
        const snap = await getDoc(doc($db, ...DOC_PATH))
        this.applyConfig(snap.exists() ? (snap.data() as Partial<AppConfig>) : null)
        this.loaded = true
      } catch (e: any) {
        this.error = e?.message || 'No se pudo cargar la configuración'
        this.applyConfig(null)
      } finally {
        this.loading = false
      }
    },

    async save(user: { uid?: string | null; email?: string | null; nombre?: string | null }) {
      const { $db } = useNuxtApp()
      this.saving = true
      this.error = null
      try {
        await setDoc(doc($db, ...DOC_PATH), {
          comprasPuedeCotizar: this.config.comprasPuedeCotizar === true,
          updatedAt: serverTimestamp(),
          updatedBy: {
            uid: user.uid || null,
            email: user.email || null,
            nombre: user.nombre || null,
          },
        }, { merge: true })
        this.savedAt = new Date()
        this.loaded = true
      } catch (e: any) {
        this.error = e?.message || 'No se pudo guardar'
        throw e
      } finally {
        this.saving = false
      }
    },
  },
})

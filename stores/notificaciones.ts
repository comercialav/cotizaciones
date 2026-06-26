import { defineStore } from 'pinia'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import {
  defaultNotificacionesConfig,
  mergeNotificacionesConfig,
  type NotificacionesConfig,
} from '~/utils/notificaciones'

const DOC_PATH = ['config', 'notificaciones'] as const

export const useNotificacionesStore = defineStore('notificaciones', {
  state: () => ({
    config: defaultNotificacionesConfig() as NotificacionesConfig,
    loading: false,
    saving: false,
    loaded: false,
    error: null as string | null,
    savedAt: null as Date | null,
  }),

  actions: {
    applyConfig(raw: Partial<NotificacionesConfig> | null | undefined) {
      this.config = mergeNotificacionesConfig(raw)
    },

    async load(force = false) {
      if (this.loaded && !force) return
      const { $db } = useNuxtApp()
      this.loading = true
      this.error = null
      try {
        const snap = await getDoc(doc($db, ...DOC_PATH))
        this.applyConfig(snap.exists() ? snap.data() as Partial<NotificacionesConfig> : null)
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
          emailEnabled: this.config.emailEnabled,
          slackEnabled: this.config.slackEnabled,
          events: this.config.events,
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

    resetToDefaults() {
      this.config = defaultNotificacionesConfig()
    },
  },
})

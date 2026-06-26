<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useUserStore } from '~/stores/user'
import { useNotificacionesStore } from '~/stores/notificaciones'
import {
  NOTIF_EVENT_DEFS,
  NOTIF_GROUPS,
  type NotifEventMeta,
} from '~/utils/notificaciones'

definePageMeta({ middleware: ['role-admin'] })

const user = useUserStore()
const store = useNotificacionesStore()
const snackbar = ref(false)
const snackbarText = ref('')

const groupedEvents = computed(() => {
  const groups: Record<string, NotifEventMeta[]> = {}
  for (const def of NOTIF_EVENT_DEFS) {
    if (!groups[def.group]) groups[def.group] = []
    groups[def.group].push(def)
  }
  return groups
})

onMounted(() => {
  store.load()
})

async function saveConfig() {
  try {
    await store.save(user)
    snackbarText.value = 'Configuración guardada correctamente'
    snackbar.value = true
  } catch {
    snackbarText.value = store.error || 'Error al guardar'
    snackbar.value = true
  }
}

function resetDefaults() {
  store.resetToDefaults()
}

// ===== Panel de pruebas =====
const eventOptions = NOTIF_EVENT_DEFS.map((e) => ({ title: e.label, value: e.id }))
const testEventId = ref<string>(NOTIF_EVENT_DEFS[0]?.id || '')
const testEmail = ref('')
const testSlackEmail = ref('')
const testSending = ref(false)
const testResult = ref<null | {
  eventId: string
  email: { attempted: boolean; ok: boolean; error?: string; rejected?: string[] }
  slack: { attempted: boolean; ok: boolean; error?: string }
}>(null)

const canSendTest = computed(() =>
  Boolean(testEventId.value) && Boolean(testEmail.value.trim() || testSlackEmail.value.trim()),
)

async function sendTest() {
  if (!canSendTest.value) return
  testSending.value = true
  testResult.value = null
  try {
    const res = await $fetch<any>('/api/notify-test', {
      method: 'POST',
      body: {
        eventId: testEventId.value,
        email: testEmail.value.trim() || undefined,
        slackEmail: testSlackEmail.value.trim() || undefined,
      },
    })
    testResult.value = res
    snackbarText.value = res?.ok ? 'Prueba enviada' : 'La prueba terminó con errores'
    snackbar.value = true
  } catch (e: any) {
    testResult.value = {
      eventId: testEventId.value,
      email: { attempted: Boolean(testEmail.value.trim()), ok: false, error: e?.data?.statusMessage || e?.message },
      slack: { attempted: Boolean(testSlackEmail.value.trim()), ok: false, error: e?.data?.statusMessage || e?.message },
    }
    snackbarText.value = e?.data?.statusMessage || 'No se pudo enviar la prueba'
    snackbar.value = true
  } finally {
    testSending.value = false
  }
}
</script>

<template>
  <v-container class="py-6 notif-page" max-width="960">
    <header class="notif-header mb-6">
      <div>
        <p class="notif-eyebrow">Administración</p>
        <h1 class="text-h5 font-weight-bold mb-1">Notificaciones</h1>
        <p class="text-medium-emphasis mb-0">
          Activa o desactiva correos y Slack por tipo de aviso. Los cambios se aplican en toda la app.
        </p>
      </div>
      <div class="notif-header__actions">
        <v-btn variant="text" @click="resetDefaults">Restaurar valores</v-btn>
        <v-btn
          color="primary"
          :loading="store.saving"
          :disabled="store.loading"
          @click="saveConfig"
        >
          <template #prepend><Icon name="mdi:content-save" /></template>
          Guardar cambios
        </v-btn>
      </div>
    </header>

    <v-skeleton-loader v-if="store.loading" type="article, article, table" />

    <template v-else>
      <v-alert v-if="store.error" type="error" variant="tonal" class="mb-4">
        {{ store.error }}
      </v-alert>

      <v-row class="mb-4">
        <v-col cols="12" md="6">
          <v-card class="notif-master-card pa-4">
            <div class="d-flex align-center justify-space-between">
              <div>
                <div class="d-flex align-center ga-2 mb-1">
                  <Icon name="mdi:email-outline" />
                  <strong>Correos electrónicos</strong>
                </div>
                <p class="text-medium-emphasis text-body-2 mb-0">
                  Interruptor global. Si lo apagas, no se enviará ningún email aunque el evento esté activo.
                </p>
              </div>
              <v-switch
                v-model="store.config.emailEnabled"
                color="primary"
                hide-details
                inset
              />
            </div>
          </v-card>
        </v-col>
        <v-col cols="12" md="6">
          <v-card class="notif-master-card pa-4">
            <div class="d-flex align-center justify-space-between">
              <div>
                <div class="d-flex align-center ga-2 mb-1">
                  <Icon name="mdi:slack" />
                  <strong>Slack (mensajes directos)</strong>
                </div>
                <p class="text-medium-emphasis text-body-2 mb-0">
                  Interruptor global para avisos por DM de Slack al email del destinatario.
                </p>
              </div>
              <v-switch
                v-model="store.config.slackEnabled"
                color="primary"
                hide-details
                inset
              />
            </div>
          </v-card>
        </v-col>
      </v-row>

      <v-card class="notif-test-card mb-6 pa-4">
        <div class="d-flex align-center ga-2 mb-1">
          <Icon name="mdi:flask-outline" />
          <strong>Enviar una prueba</strong>
        </div>
        <p class="text-medium-emphasis text-body-2 mb-4">
          Comprueba que cada aviso llega correctamente. Se usa una cotización de ejemplo y se envía
          al correo y/o usuario de Slack que indiques. Las pruebas se envían aunque el aviso esté
          desactivado arriba (sirven para verificar la entrega).
        </p>

        <v-row dense>
          <v-col cols="12" md="4">
            <v-select
              v-model="testEventId"
              :items="eventOptions"
              label="Tipo de aviso"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
              v-model="testEmail"
              label="Email de prueba (opcional)"
              placeholder="tu@correo.com"
              variant="outlined"
              density="comfortable"
              type="email"
              hide-details
            >
              <template #prepend-inner><Icon name="mdi:email-outline" /></template>
            </v-text-field>
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
              v-model="testSlackEmail"
              label="Email del usuario de Slack (opcional)"
              placeholder="usuario@empresa.com"
              variant="outlined"
              density="comfortable"
              type="email"
              hide-details
            >
              <template #prepend-inner><Icon name="mdi:slack" /></template>
            </v-text-field>
          </v-col>
        </v-row>

        <div class="d-flex align-center ga-3 mt-4 flex-wrap">
          <v-btn
            color="primary"
            :loading="testSending"
            :disabled="!canSendTest"
            @click="sendTest"
          >
            <template #prepend><Icon name="mdi:send" /></template>
            Enviar prueba
          </v-btn>
          <span class="text-caption text-medium-emphasis">
            El Slack se localiza por el email del usuario en tu workspace.
          </span>
        </div>

        <div v-if="testResult" class="notif-test-result mt-4">
          <v-alert
            v-if="testResult.email.attempted"
            :type="testResult.email.ok ? 'success' : 'error'"
            variant="tonal"
            density="compact"
            class="mb-2"
          >
            <strong>Email:</strong>
            <template v-if="testResult.email.ok">enviado correctamente.</template>
            <template v-else>error — {{ testResult.email.error || 'no se pudo enviar' }}</template>
          </v-alert>
          <v-alert
            v-if="testResult.slack.attempted"
            :type="testResult.slack.ok ? 'success' : 'error'"
            variant="tonal"
            density="compact"
            class="mb-0"
          >
            <strong>Slack:</strong>
            <template v-if="testResult.slack.ok">mensaje directo enviado.</template>
            <template v-else>error — {{ testResult.slack.error || 'no se pudo enviar' }}</template>
          </v-alert>
        </div>
      </v-card>

      <section
        v-for="(events, groupKey) in groupedEvents"
        :key="groupKey"
        class="mb-6"
      >
        <h2 class="notif-group-title">{{ NOTIF_GROUPS[groupKey as keyof typeof NOTIF_GROUPS] }}</h2>

        <v-card
          v-for="eventDef in events"
          :key="eventDef.id"
          class="notif-event-card mb-3"
        >
          <div class="notif-event-card__body">
            <div class="notif-event-card__copy">
              <h3 class="text-subtitle-1 font-weight-bold mb-1">{{ eventDef.label }}</h3>
              <p class="text-body-2 mb-2">{{ eventDef.description }}</p>
              <div class="notif-meta">
                <span><Icon name="mdi:flash-outline" /> {{ eventDef.when }}</span>
                <span><Icon name="mdi:account-arrow-right-outline" /> {{ eventDef.recipients }}</span>
              </div>
            </div>

            <div class="notif-event-card__toggles">
              <div v-if="eventDef.channels.email" class="notif-toggle">
                <span>Email</span>
                <v-switch
                  v-model="store.config.events[eventDef.id].email"
                  color="primary"
                  hide-details
                  density="compact"
                  :disabled="!store.config.emailEnabled"
                />
              </div>
              <div v-else class="notif-toggle notif-toggle--na">
                <span>Email</span>
                <v-chip size="x-small" variant="tonal">N/A</v-chip>
              </div>

              <div v-if="eventDef.channels.slack" class="notif-toggle">
                <span>Slack</span>
                <v-switch
                  v-model="store.config.events[eventDef.id].slack"
                  color="primary"
                  hide-details
                  density="compact"
                  :disabled="!store.config.slackEnabled"
                />
              </div>
              <div v-else class="notif-toggle notif-toggle--na">
                <span>Slack</span>
                <v-chip size="x-small" variant="tonal">N/A</v-chip>
              </div>
            </div>
          </div>
        </v-card>
      </section>

      <v-alert type="info" variant="tonal" class="notif-footnote">
        <strong>Nota:</strong> los tokens SMTP y de Slack siguen en variables de entorno del servidor.
        Esta pantalla solo controla qué avisos se envían, no las credenciales.
      </v-alert>
    </template>

    <v-snackbar v-model="snackbar" :timeout="3000" color="success">
      {{ snackbarText }}
    </v-snackbar>
  </v-container>
</template>

<style scoped>
.notif-page {
  max-width: 960px;
}
.notif-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.notif-header__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.notif-eyebrow {
  margin: 0 0 4px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #64748b;
}
.notif-master-card {
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  height: 100%;
}
.notif-test-card {
  border: 1px solid #dbeafe;
  border-radius: 14px;
  background: #f8fbff;
}
.notif-group-title {
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #475569;
  margin: 0 0 12px;
}
.notif-event-card {
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  overflow: hidden;
}
.notif-event-card__body {
  display: flex;
  gap: 20px;
  padding: 16px 18px;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
}
.notif-event-card__copy {
  flex: 1;
  min-width: 240px;
}
.notif-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.78rem;
  color: #64748b;
}
.notif-meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.notif-event-card__toggles {
  display: flex;
  gap: 20px;
  align-items: center;
  flex-shrink: 0;
}
.notif-toggle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 64px;
  font-size: 0.78rem;
  font-weight: 600;
  color: #475569;
}
.notif-toggle--na {
  opacity: 0.55;
}
.notif-footnote {
  border-radius: 12px;
}
@media (max-width: 600px) {
  .notif-event-card__toggles {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>

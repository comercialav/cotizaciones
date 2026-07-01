<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useUserStore } from '~/stores/user'

definePageMeta({ middleware: ['role-admin'] })

const { authFetch } = useAuthFetch()
const user = useUserStore()

type AppUser = {
  id: string
  authUid: string
  email: string
  nombre: string
  rol: string
  activo: boolean
  esSupervisor: boolean
}

const loading = ref(false)
const saving = ref(false)
const users = ref<AppUser[]>([])
const error = ref('')
const snackbar = ref(false)
const snackbarText = ref('')

const dialog = ref(false)
const resetLink = ref('')
const resetDialog = ref(false)

const form = ref({
  email: '',
  nombre: '',
  rol: 'comercial',
})

const roleOptions = [
  { title: 'Comercial', value: 'comercial' },
  { title: 'Compras', value: 'compras' },
  { title: 'Jefe comercial', value: 'jefe_comercial' },
  { title: 'Admin', value: 'admin' },
]

function roleLabel(rol: string) {
  return roleOptions.find((r) => r.value === rol)?.title || rol
}

async function loadUsers() {
  loading.value = true
  error.value = ''
  try {
    const res = await authFetch<{ users: AppUser[] }>('/api/admin/users')
    users.value = res.users || []
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || 'No se pudieron cargar los usuarios'
  } finally {
    loading.value = false
  }
}

onMounted(loadUsers)

async function createUser() {
  saving.value = true
  error.value = ''
  try {
    const res = await authFetch<any>('/api/admin/users', {
      method: 'POST',
      body: form.value,
    })
    snackbarText.value = res.message || 'Usuario creado'
    snackbar.value = true
    if (res.resetLink) {
      resetLink.value = res.resetLink
      resetDialog.value = true
    }
    dialog.value = false
    form.value = { email: '', nombre: '', rol: 'comercial' }
    await loadUsers()
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || 'Error al crear usuario'
  } finally {
    saving.value = false
  }
}

async function toggleActive(u: AppUser) {
  saving.value = true
  error.value = ''
  try {
    await authFetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      body: { activo: !u.activo },
    })
    u.activo = !u.activo
    snackbarText.value = u.activo ? 'Usuario activado' : 'Usuario desactivado'
    snackbar.value = true
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || 'No se pudo actualizar'
  } finally {
    saving.value = false
  }
}

async function sendResetLink(u: AppUser) {
  saving.value = true
  error.value = ''
  try {
    const res = await authFetch<any>(`/api/admin/users/${u.id}/reset-password`, { method: 'POST' })
    resetLink.value = res.resetLink || ''
    resetDialog.value = true
    snackbarText.value = res.message || 'Enlace generado'
    snackbar.value = true
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || 'No se pudo generar el enlace'
  } finally {
    saving.value = false
  }
}

async function copyResetLink() {
  if (!resetLink.value) return
  await navigator.clipboard.writeText(resetLink.value)
  snackbarText.value = 'Enlace copiado al portapapeles'
  snackbar.value = true
}
</script>

<template>
  <v-container class="py-6" max-width="1100">
    <header class="d-flex align-start justify-space-between flex-wrap ga-4 mb-6">
      <div>
        <p class="text-overline mb-1">Administración</p>
        <h1 class="text-h5 font-weight-bold mb-1">Usuarios</h1>
        <p class="text-medium-emphasis mb-0">
          Alta de comerciales y control de acceso. El usuario elige su contraseña con el enlace que le envíes.
        </p>
      </div>
      <v-btn color="primary" @click="dialog = true">
        <template #prepend><Icon name="mdi:account-plus-outline" /></template>
        Nuevo usuario
      </v-btn>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <ClientOnly>
      <v-alert type="info" variant="tonal" class="mb-4">
        Tu sesión: <strong>{{ user.email }}</strong> · rol <strong>{{ user.rol || 'sin rol' }}</strong>.
        Para gestionar usuarios necesitas rol admin.
      </v-alert>
    </ClientOnly>

    <v-skeleton-loader v-if="loading" type="table" />

    <v-card v-else>
      <v-table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Email</th>
            <th>Rol</th>
            <th>Estado</th>
            <th class="text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.nombre || '—' }}</td>
            <td>{{ u.email }}</td>
            <td>{{ roleLabel(u.rol) }}</td>
            <td>
              <v-chip size="small" :color="u.activo ? 'success' : 'error'" variant="tonal">
                {{ u.activo ? 'Activo' : 'Inactivo' }}
              </v-chip>
            </td>
            <td class="text-right">
              <v-btn
                size="small"
                variant="text"
                :loading="saving"
                @click="sendResetLink(u)"
              >
                Enlace contraseña
              </v-btn>
              <v-btn
                size="small"
                variant="text"
                :color="u.activo ? 'error' : 'success'"
                :loading="saving"
                @click="toggleActive(u)"
              >
                {{ u.activo ? 'Desactivar' : 'Activar' }}
              </v-btn>
            </td>
          </tr>
          <tr v-if="!users.length">
            <td colspan="5" class="text-medium-emphasis py-6 text-center">
              No hay usuarios registrados todavía.
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-dialog v-model="dialog" max-width="520">
      <v-card class="pa-4">
        <v-card-title class="text-h6">Nuevo usuario</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="form.nombre"
            label="Nombre completo"
            variant="outlined"
            class="mb-3"
          />
          <v-text-field
            v-model="form.email"
            label="Email corporativo"
            type="email"
            variant="outlined"
            class="mb-3"
          />
          <v-select
            v-model="form.rol"
            :items="roleOptions"
            item-title="title"
            item-value="value"
            label="Rol"
            variant="outlined"
          />
          <p class="text-caption text-medium-emphasis mt-3 mb-0">
            Tras crearlo recibirás un enlace para que el usuario defina su contraseña.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">Cancelar</v-btn>
          <v-btn color="primary" :loading="saving" @click="createUser">Crear</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="resetDialog" max-width="640">
      <v-card class="pa-4">
        <v-card-title class="text-h6">Enlace para establecer contraseña</v-card-title>
        <v-card-text>
          <p class="mb-3">Copia y envía este enlace al usuario (caduca en unas horas):</p>
          <v-textarea
            :model-value="resetLink"
            readonly
            auto-grow
            variant="outlined"
            rows="3"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="resetDialog = false">Cerrar</v-btn>
          <v-btn color="primary" @click="copyResetLink">Copiar enlace</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :timeout="3500">{{ snackbarText }}</v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'
import { useUserStore } from '~/stores/user'

const user = useUserStore()
const { $auth } = useNuxtApp()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref('')
const success = ref('')
const showCurrent = ref(false)
const showNew = ref(false)

function roleLabel(r?: string | null) {
  const x = (r || '').toLowerCase()
  if (x === 'jefe_comercial') return 'Jefe comercial'
  if (x === 'compras') return 'Compras'
  if (x === 'admin') return 'Admin'
  return 'Comercial'
}

async function changePassword() {
  error.value = ''
  success.value = ''

  if (!currentPassword.value || !newPassword.value) {
    error.value = 'Completa la contraseña actual y la nueva.'
    return
  }
  if (newPassword.value.length < 8) {
    error.value = 'La nueva contraseña debe tener al menos 8 caracteres.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Las contraseñas nuevas no coinciden.'
    return
  }

  const authUser = $auth.currentUser
  if (!authUser?.email) {
    error.value = 'No hay sesión válida.'
    return
  }

  loading.value = true
  try {
    const credential = EmailAuthProvider.credential(authUser.email, currentPassword.value)
    await reauthenticateWithCredential(authUser, credential)
    await updatePassword(authUser, newPassword.value)
    success.value = 'Contraseña actualizada correctamente.'
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (e: any) {
    const code = e?.code || ''
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      error.value = 'La contraseña actual no es correcta.'
    } else {
      error.value = e?.message || 'No se pudo cambiar la contraseña.'
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <v-container class="py-6" max-width="720">
    <header class="mb-6">
      <p class="text-overline mb-1">Cuenta</p>
      <h1 class="text-h5 font-weight-bold mb-1">Mi perfil</h1>
      <p class="text-medium-emphasis mb-0">Consulta tus datos y cambia tu contraseña cuando quieras.</p>
    </header>

    <v-row>
      <v-col cols="12" md="6">
        <v-card class="pa-4 mb-4">
          <h2 class="text-subtitle-1 font-weight-bold mb-4">Datos de acceso</h2>
          <div class="profile-field mb-3">
            <span class="profile-label">Nombre</span>
            <span>{{ user.nombre || '—' }}</span>
          </div>
          <div class="profile-field mb-3">
            <span class="profile-label">Email</span>
            <span>{{ user.email || '—' }}</span>
          </div>
          <div class="profile-field">
            <span class="profile-label">Rol</span>
            <v-chip size="small" variant="tonal">{{ roleLabel(user.rol) }}</v-chip>
          </div>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card class="pa-4">
          <h2 class="text-subtitle-1 font-weight-bold mb-4">Cambiar contraseña</h2>

          <v-alert v-if="error" type="error" variant="tonal" class="mb-3">{{ error }}</v-alert>
          <v-alert v-if="success" type="success" variant="tonal" class="mb-3">{{ success }}</v-alert>

          <v-text-field
            v-model="currentPassword"
            label="Contraseña actual"
            :type="showCurrent ? 'text' : 'password'"
            variant="outlined"
            class="mb-3"
            :append-inner-icon="showCurrent ? 'mdi-eye-off' : 'mdi-eye'"
            @click:append-inner="showCurrent = !showCurrent"
          />
          <v-text-field
            v-model="newPassword"
            label="Nueva contraseña"
            :type="showNew ? 'text' : 'password'"
            variant="outlined"
            class="mb-3"
            hint="Mínimo 8 caracteres"
            persistent-hint
            :append-inner-icon="showNew ? 'mdi-eye-off' : 'mdi-eye'"
            @click:append-inner="showNew = !showNew"
          />
          <v-text-field
            v-model="confirmPassword"
            label="Confirmar nueva contraseña"
            type="password"
            variant="outlined"
            class="mb-4"
          />

          <v-btn color="primary" :loading="loading" @click="changePassword">
            Guardar contraseña
          </v-btn>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
.profile-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.profile-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
}
</style>

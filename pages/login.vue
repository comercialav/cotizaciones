<script setup lang="ts">
import { getAuth, signInWithEmailAndPassword } from "firebase/auth"
import { useRouter } from "vue-router"

definePageMeta({ layout: "auth" })

const email = ref("")
const password = ref("")
const error = ref("")
const loading = ref(false)

const router = useRouter()

async function login() {
  const auth = getAuth()
  error.value = ""
  loading.value = true
  try {
    await signInWithEmailAndPassword(auth, email.value, password.value)
    router.push("/") // redirige al dashboard tras login
  } catch (err: any) {
    error.value = "Usuario o contraseña incorrectos"
    console.error(err)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <!-- NAVBAR LOGIN -->
   <v-app-bar
    absolute
    flat
    elevation="0"
    class="transparent-bar px-8 py-5"
    >
    <!-- Logo -->
    <NuxtLink to="/" class="flex items-center">
        <img src="/logo.png" alt="Logo Comercial AV" height="60" />
    </NuxtLink>

    <!-- Spacer izquierda -->
    <v-spacer />


    <!-- Spacer derecha -->
    <v-spacer />
    </v-app-bar>


    <!-- CONTENIDO PRINCIPAL -->
    <div class="main-content">
      <div class="login-card">
        <h2 class="text-2xl font-bold mb-6">Iniciar Sesión</h2>

        <v-text-field
          v-model="email"
          label="Correo electrónico"
          prepend-inner-icon="mdi-email"
          outlined
          dense
        />
        <v-text-field
          v-model="password"
          type="password"
          label="Contraseña"
          prepend-inner-icon="mdi-lock"
          outlined
          dense
        />
        <p v-if="error" class="text-red-500 mb-2">{{ error }}</p>

        <v-btn
          block
          color="primary"
          :loading="loading"
          @click="login"
          class="mt-4"
        >
          Entrar
        </v-btn>
      </div>
    </div>

    <!-- FOOTER -->
    <footer class="footer">
      <div class="text-center text-sm text-gray-300">
        © {{ new Date().getFullYear() }} Comercial AV · Todos los derechos reservados
      </div>
    </footer>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: linear-gradient(135deg, #e6f0fa, #f9fbff);
  background-image: url("/login-bg-auth.png"); /* aquí podrías poner una imagen moderna */
  background-size: cover;
  background-position: center;
}
.main-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding-left: 8%;
}
.login-card {
  background: rgba(255, 255, 255, 0.9);
  padding: 2rem;
  border-radius: 16px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.1);
  width: 350px;
}
.footer {
  background: #006bba;
  padding: 1rem;
  color: #fff;
}
.links a {
  font-weight: 500;
  color: #333;
  text-decoration: none;
  transition: color 0.2s;
  padding: 0 10px;
}
.links a:hover {
  color: #1976d2;
}
.transparent-bar {
  background-color: transparent !important;
  box-shadow: none !important;
}
.links a {
  color: #1a1a1a;
  text-decoration: none;
  transition: color 0.2s ease;
}
.links a:hover {
  color: #1976d2;
}


</style>

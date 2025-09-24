<script setup lang="ts">
import { useRouter } from "vue-router"
import { useUserStore } from "~/stores/user"
import {
  collection, query, where, getDocs, orderBy, startAt, endAt, limit
} from "firebase/firestore"
import { getAuth, signOut } from "firebase/auth"

const router = useRouter()
const { $db } = useNuxtApp()
const user = useUserStore()

/** ---------- UI state ---------- */
const userMenu = ref(false)

// Search overlay
const searchOpen = ref(false)
const searchTerm = ref("")
const searchLoading = ref(false)
const searchResults = ref<any[]>([])
const searchError = ref<string | null>(null)

// Slack avatar (fallback a iniciales si no hay)
const avatarUrl = ref<string | null>(null)

/** ---------- helpers ---------- */
const isSupervisor = computed(
  () => user.rol === "jefe_comercial" || user.esSupervisor === true
)

function roleLabel(r?: string | null) {
  const x = (r || "").toLowerCase()
  if (x === "jefe_comercial") return "Jefa comercial"
  if (x === "compras") return "Compras"
  if (x === "admin") return "Admin"
  return "Comercial"
}
function fmtDate(ts?: any) {
  const d = ts?.toDate?.() ?? ts ?? null
  if (!d) return "—"
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(d)
}
function sumLineas(art: any[]) {
  return (art || []).reduce((a, r) =>
    a + (Number(r.unidades) || 0) * (Number(r.precioSolicitado) || 0), 0)
}
function initials(name?: string | null) {
  return (name || user.email || "U").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]?.toUpperCase()||"").join("")
}

/** ---------- Slack avatar ---------- */
async function loadSlackAvatar() {
  try {
    if (!user.email) return
    const res: any = await $fetch("/api/slack/avatar", { query: { email: user.email } })
    if (res?.ok && res.url) avatarUrl.value = res.url
  } catch (e) {
    // silencioso
  }
}
watch(() => user.email, (e) => { if (e) loadSlackAvatar() }, { immediate: true })

/** ---------- Search logic (debounced) ---------- */
let t: any = null
watch(searchTerm, (val) => {
  if (!searchOpen.value) return
  clearTimeout(t)
  t = setTimeout(() => doSearch(val.trim()), 300)
})

async function doSearch(term: string) {
  searchError.value = null
  searchResults.value = []
  if (term.length < 2) return
  searchLoading.value = true
  try {
    const base = collection($db, "cotizaciones")
    const scope = []
    if (!isSupervisor.value) {
      // sólo sus cotizaciones
      scope.push(where("vendedor.uid", "==", user.uid || "__none__"))
    }

    // 1) número exacto
    const q1 = query(base, ...scope, where("numero", "==", term), limit(5))
    const s1 = await getDocs(q1)

    // 2) cliente prefix (case sensitive; si tienes clienteLower crea índice y cambia a orderBy('clienteLower'))
    const q2 = query(base, ...scope, orderBy("cliente"), startAt(term), endAt(term + "\uf8ff"), limit(5))
    const s2 = await getDocs(q2)

    // Mezclar únicos
    const map: Record<string, any> = {}
    for (const d of [...s1.docs, ...s2.docs]) {
      const item = { id: d.id, ...d.data() }
      map[d.id] = item
    }
    searchResults.value = Object.values(map).slice(0, 8)
  } catch (e: any) {
    searchError.value = e?.message || "Error buscando"
  } finally {
    searchLoading.value = false
  }
}

function openSearch() {
  searchOpen.value = true
  nextTick(() => {
    const el = document.getElementById("navbar-search-input")
    el?.focus()
  })
}
function closeSearch() {
  searchOpen.value = false
  searchTerm.value = ""
  searchResults.value = []
}

function goToCot(id: string) {
  closeSearch()
  router.push(`/cotizaciones/${id}`)
}

/** ---------- Auth ---------- */
async function logout() {
  try {
    await signOut(getAuth())
    router.push("/login")
  } catch (err) {
    console.error("Error al cerrar sesión:", err)
  }
}
</script>

<template>
  <v-app-bar
    app
    flat
    elevate-on-scroll
    class="px-4 navbar"
  >
    <!-- Izquierda: Logo -->
    <div class="left-wrap">
      <NuxtLink to="/" class="logo-link">
        <img src="/logo.png" alt="Logo" width="56" height="auto" class="logo hover-scale" />
      </NuxtLink>

      <!-- Frase con icono animado -->
      <div class="promo-pill mr-2">
        <span class="flame">📊</span>
        <span class="promo-text">
          Mantén tus estádísticas al día — ¡Actualiza el estado de tus cotizaciones!
        </span>
      </div>
    </div>

    <!-- Centro: Menú -->
    <div class="center-menu">
      <NuxtLink to="/" class="nav-btn">
        <Icon name="mdi:view-dashboard" class="me-1" /> Dashboard
      </NuxtLink>
      <NuxtLink to="/cotizaciones/nueva" class="nav-btn">
        <Icon name="mdi:plus-box" class="me-1" /> Nueva
      </NuxtLink>
      <NuxtLink to="/cotizaciones" class="nav-btn">
        <Icon name="mdi:clock-outline" class="me-1" /> Cotizaciones
      </NuxtLink>
    </div>

    <v-spacer />

    <!-- Derecha: icono de búsqueda + avatar -->
    <div class="right-wrap">
      <button class="icon-btn" aria-label="Buscar" @click="openSearch">
        <Icon name="mdi:magnify" />
      </button>

      <v-menu v-model="userMenu" offset-y transition="scale-transition">
        <template #activator="{ props }">
          <div class="user-info-trigger" v-bind="props">
            <v-avatar size="40" class="avatar hover-scale">
              <img v-if="avatarUrl" :src="avatarUrl" alt="avatar" width="40" />
              <span v-else>{{ initials(user.nombre) }}</span>
            </v-avatar>
            <div class="user-text">
              <div class="user-name">{{ user.nombre || user.email }}</div>
              <div class="user-role">{{ roleLabel(user.rol) }}</div>
            </div>
          </div>
        </template>

        <v-list>
          <v-list-item @click="router.push('/perfil')">
            <v-list-item-title>Perfil</v-list-item-title>
          </v-list-item>
          <v-list-item @click="logout">
            <v-list-item-title>Cerrar sesión</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </div>

    <!-- Overlay de búsqueda -->
    <transition name="fade">
      <div v-if="searchOpen" class="search-overlay" @keydown.esc="closeSearch">
        <div class="search-bar">
          <Icon name="mdi:magnify" class="search-ico" />
          <input
            id="navbar-search-input"
            v-model="searchTerm"
            type="text"
            placeholder="Buscar por Nº de cotización o cliente…"
            class="search-input"
          />
          <button class="icon-btn close" aria-label="Cerrar" @click="closeSearch">
            <Icon name="mdi:close" />
          </button>
        </div>

        <!-- Resultados -->
        <div class="results" v-if="searchTerm && (searchLoading || searchResults.length || searchError)">
          <div class="result-row muted" v-if="searchLoading">Buscando…</div>
          <div class="result-row error" v-else-if="searchError">{{ searchError }}</div>

          <template v-else>
            <div
              v-for="r in searchResults"
              :key="r.id"
              class="result-row"
              @click="goToCot(r.id)"
            >
              <div class="left">
                <div class="title">
                  <strong>#{{ r.numero }}</strong> — {{ r.cliente || '—' }}
                </div>
                <div class="sub">
                  {{ fmtDate(r.updatedAt || r.fechaCreacion) }}
                </div>
              </div>
              <div class="right">
                € {{ sumLineas(r.articulos).toFixed(2) }}
              </div>
            </div>

            <div class="result-row muted" v-if="!searchResults.length">
              Sin resultados
            </div>
          </template>
        </div>
      </div>
    </transition>
  </v-app-bar>
</template>

<style scoped>
/* ---------- Barra base ---------- */
.navbar{
  background: linear-gradient(90deg,#1e1e2f,#2a2a40);
  border-bottom: 1px solid rgba(0,255,255,.18);
  box-shadow: 0 0 18px rgba(0,255,255,.25);
  display:flex; align-items:center; gap:14px;
}

/* IZQ */
.left-wrap{ display:flex; align-items:center; gap:14px; }
.logo-link{ display:flex; align-items:center; }
.logo{ filter: drop-shadow(0 4px 12px rgba(0,0,0,.3)); }

/* Pill promo */
.promo-pill{
  display:flex; align-items:center; gap:8px;
  padding:6px 12px; border-radius:9999px;
  background: rgba(99,102,241,.12);
  color:#e5e7eb; font-weight:600; letter-spacing:.2px;
  box-shadow: 0 0 12px rgba(99,102,241,.25) inset;
}
.flame{ display:inline-block; animation: wiggle 1.3s ease-in-out infinite; }
@keyframes wiggle{
  0%,100%{ transform: rotate(0deg) }
  50%{ transform: rotate(-12deg) }
}

/* MENÚ centro */
.center-menu{ display:flex; align-items:center; gap:8px; margin:0 auto; }
.nav-btn{
  display:inline-flex; align-items:center; gap:6px;
  padding:8px 12px; border-radius:10px;
  color:#c7d2fe; text-decoration:none; font-weight:600;
  transition: background .2s, transform .2s;
}
.nav-btn:hover{ background: rgba(59,130,246,.12); transform: translateY(-1px); }

/* DERECHA */
.right-wrap{ display:flex; align-items:center; gap:8px; }
.icon-btn{
  width:40px; height:40px; border-radius:12px; display:grid; place-items:center;
  background: rgba(255,255,255,.06);
  color:#e5e7eb; border:1px solid rgba(255,255,255,.08);
  transition: transform .15s, background .15s;
}
.icon-btn:hover{ transform: translateY(-1px); background: rgba(255,255,255,.12); }
.icon-btn.close{ margin-left:8px; }

/* Avatar */
.avatar{
  background: linear-gradient(135deg,#6d28d9,#4f46e5);
  color:#fff; font-weight:700;
  overflow:hidden;
}

/* Hovers comunes */
.hover-scale{ transition: transform .2s ease; }
.hover-scale:hover{ transform: scale(1.08); }

/* ---------- Overlay de búsqueda ---------- */
.fade-enter-active,.fade-leave-active{ transition: opacity .15s ease; }
.fade-enter-from,.fade-leave-to{ opacity:0; }

.search-overlay{
  position: fixed; top:0; left:0; right:0;
  padding:10px 16px 12px;
  background: linear-gradient(90deg,#1e1e2fcc,#2a2a40cc);
  backdrop-filter: blur(6px);
  z-index: 1200; /* sobre la app-bar */
  border-bottom: 1px solid rgba(0,255,255,.18);
  box-shadow: 0 6px 22px rgba(0,0,0,.35);
}

/* barra */
.search-bar{
  max-width: 980px; margin: 0 auto;
  display:flex; align-items:center; gap:10px;
  padding:10px 12px; border-radius:14px;
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.16);
}
.search-ico{ color:#c7d2fe; font-size: 22px; }
.search-input{
  flex:1; height:36px; outline:none; border:none;
  background: transparent; color:#fff; font-size:16px;
}

/* resultados */
.results{
  max-width: 980px; margin: 10px auto 0; overflow: hidden;
  border-radius: 12px; border:1px solid rgba(255,255,255,.12);
  background: rgba(10,14,30,.75);
}
.result-row{
  display:flex; align-items:center; justify-content:space-between;
  padding:10px 14px; gap:16px; cursor:pointer;
  color:#e5e7eb; border-top:1px solid rgba(255,255,255,.06);
}
.result-row:first-child{ border-top:0; }
.result-row:hover{ background: rgba(59,130,246,.12); }
.result-row .title{ font-weight:700 }
.result-row .sub{ color:#94a3b8; font-size:12px }
.result-row .right{ font-weight:700; color:#93c5fd }
.result-row.muted{ color:#94a3b8; cursor:default }
.result-row.error{ color:#fca5a5; cursor:default }

.user-info-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.user-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.user-name {
  font-weight: 600;
  font-size: 14px;
  color: #fff; /* puedes ajustarlo a tu tema */
}
.user-role {
  font-size: 12px;
  color: #93c5fd; /* azul clarito */
}
</style>

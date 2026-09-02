<script setup lang="ts">
import { useRouter } from "vue-router"
import { useUserStore } from "~/stores/user"
import { fetchCotizacionesForScope, getCotizacionMs } from '~/utils/cotizacion-access'
import { articuloLabel, hydrateArticuloIdentidad } from '~/utils/articulos'
import { sumLineasPrecioCotizado, sumLineasTarifa } from '~/utils/cotizacion-totales'

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
const searchTotalMatches = ref(0)
const searchError = ref<string | null>(null)
const SEARCH_LIMIT = 20

// Slack avatar (fallback a iniciales si no hay)
const avatarUrl = ref<string | null>(null)

/** ---------- helpers ---------- */
const isSupervisor = computed(
  () => user.rol === "jefe_comercial" || user.rol === "admin" || user.esSupervisor === true
)
const isAdmin = computed(() => user.isAdmin)

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
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(d)
}
function fechaCotizacion(c: any) {
  return c?.fechaCreacion || c?.createdAt || c?.updatedAt
}
function totalBusqueda(art: any[]) {
  const cotizado = sumLineasPrecioCotizado(art)
  if (cotizado > 0) return cotizado
  return sumLineasTarifa(art)
}
function initials(name?: string | null) {
  return (name || user.email || "U").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]?.toUpperCase()||"").join("")
}

function norm(s: unknown) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .trim()
}

function articulosOf(c: any): any[] {
  return Array.isArray(c?.articulos) ? c.articulos : []
}

function articuloMatches(a: any, q: string) {
  const id = hydrateArticuloIdentidad(a || {})
  return (
    norm(id.codigoProducto).includes(q) ||
    norm(id.descripcionProducto).includes(q) ||
    norm(id.articulo).includes(q)
  )
}

function matchingArticulos(c: any, term: string) {
  const q = norm(term)
  if (!q) return []
  return articulosOf(c).filter(a => articuloMatches(a, q))
}

function matchesSearch(c: any, term: string) {
  const q = norm(term)
  if (!q) return false
  if (norm(c?.cliente).includes(q) || norm(c?.numero).includes(q)) return true
  return matchingArticulos(c, term).length > 0
}

function productHint(c: any, term: string) {
  const hits = matchingArticulos(c, term)
  if (!hits.length) return ''
  const first = articuloLabel(hydrateArticuloIdentidad(hits[0]))
  if (hits.length === 1) return first
  return `${first} (+${hits.length - 1})`
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

let t: any = null
watch(searchTerm, (val) => {
  const q = val.trim()
  if (q.length >= 2) searchOpen.value = true
  clearTimeout(t)
  t = setTimeout(() => doSearch(q), 300)
})

async function doSearch(term: string) {
  searchError.value = null
  searchResults.value = []
  searchTotalMatches.value = 0
  if (term.length < 2 || !process.client) return
  searchLoading.value = true
  try {
    const matches = (await fetchCotizacionesForScope($db as any, {
      isSupervisor: isSupervisor.value,
      scopeUids: user.scopeUids?.length ? user.scopeUids : (user.uid ? [user.uid] : []),
      userEmail: user.email,
      max: 400,
    }))
      .filter(c => matchesSearch(c, term))
      .sort((a, b) => getCotizacionMs(b) - getCotizacionMs(a))

    searchTotalMatches.value = matches.length
    searchResults.value = matches.slice(0, SEARCH_LIMIT)
  } catch (e: any) {
    searchError.value = e?.message || 'Error buscando'
  } finally {
    searchLoading.value = false
  }
}

function openSearch() {
  searchOpen.value = true
  nextTick(() => {
    document.getElementById("navbar-search-input")?.focus()
  })
}
function closeSearch() {
  searchOpen.value = false
  searchTerm.value = ""
  searchResults.value = []
  searchTotalMatches.value = 0
  searchError.value = null
}
function onSearchBlur() {
  // Deja tiempo al click en un resultado
  setTimeout(() => {
    if (!searchTerm.value.trim()) searchOpen.value = false
  }, 180)
}

function goToCot(id: string) {
  closeSearch()
  router.push(`/cotizaciones/${id}`)
}

/** ---------- Auth ---------- */
async function logout() {
  userMenu.value = false
  avatarUrl.value = null
  try {
    await user.logout()
    await navigateTo("/login")
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
    color="#1e1e2f"
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
      <ClientOnly>
        <NuxtLink v-if="isAdmin" to="/admin/ajustes" class="nav-btn">
          <Icon name="mdi:tune-variant" class="me-1" /> Ajustes
        </NuxtLink>
        <NuxtLink v-if="isAdmin" to="/admin/notificaciones" class="nav-btn">
          <Icon name="mdi:bell-cog-outline" class="me-1" /> Notificaciones
        </NuxtLink>
        <NuxtLink v-if="isAdmin" to="/admin/usuarios" class="nav-btn">
          <Icon name="mdi:account-cog-outline" class="me-1" /> Usuarios
        </NuxtLink>
      </ClientOnly>
    </div>

    <!-- Buscador siempre visible (rellena el hueco del spacer) -->
    <div class="search-wrap">
      <div class="search-inline" @keydown.esc="closeSearch">
        <Icon name="mdi:magnify" class="search-ico" />
        <input
          id="navbar-search-input"
          v-model="searchTerm"
          type="search"
          placeholder="Buscar nº, cliente o producto…"
          class="search-input"
          autocomplete="off"
          @focus="openSearch"
          @blur="onSearchBlur"
        />
        <button
          v-if="searchTerm"
          type="button"
          class="icon-btn close"
          aria-label="Limpiar búsqueda"
          @mousedown.prevent="closeSearch"
        >
          <Icon name="mdi:close" />
        </button>
      </div>

      <transition name="fade">
        <div
          v-if="searchOpen && searchTerm.trim().length >= 2"
          class="search-dropdown"
        >
          <div class="result-row muted" v-if="searchLoading">Buscando…</div>
          <div class="result-row error" v-else-if="searchError">{{ searchError }}</div>
          <template v-else>
            <div
              v-for="r in searchResults"
              :key="r.id"
              class="result-row"
              @mousedown.prevent="goToCot(r.id)"
            >
              <div class="left">
                <div class="title">
                  <strong>#{{ r.numero }}</strong> — {{ r.cliente || '—' }}
                </div>
                <div class="sub" v-if="productHint(r, searchTerm)">
                  {{ productHint(r, searchTerm) }}
                </div>
              </div>
              <div class="right">
                <div class="date">{{ fmtDate(fechaCotizacion(r)) }}</div>
                <div class="amount">€ {{ totalBusqueda(r.articulos).toFixed(2) }}</div>
              </div>
            </div>
            <div class="result-row muted" v-if="!searchResults.length">
              Sin resultados
            </div>
            <div
              class="result-row muted more"
              v-else-if="searchTotalMatches > searchResults.length"
            >
              Mostrando {{ searchResults.length }} de {{ searchTotalMatches }} · afiná la búsqueda para ver más
            </div>
          </template>
        </div>
      </transition>
    </div>

    <!-- Derecha: avatar -->
    <div class="right-wrap">
      <ClientOnly>
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
            <v-list-item v-if="isAdmin" @click="router.push('/admin/ajustes')">
              <template #prepend><Icon name="mdi:tune-variant" /></template>
              <v-list-item-title>Ajustes</v-list-item-title>
            </v-list-item>
            <v-list-item v-if="isAdmin" @click="router.push('/admin/notificaciones')">
              <template #prepend><Icon name="mdi:bell-cog-outline" /></template>
              <v-list-item-title>Notificaciones</v-list-item-title>
            </v-list-item>
            <v-list-item v-if="isAdmin" @click="router.push('/admin/usuarios')">
              <template #prepend><Icon name="mdi:account-cog-outline" /></template>
              <v-list-item-title>Usuarios</v-list-item-title>
            </v-list-item>
            <v-list-item @click="router.push('/perfil')">
              <v-list-item-title>Perfil</v-list-item-title>
            </v-list-item>
            <v-list-item @click="logout">
              <v-list-item-title>Cerrar sesión</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </ClientOnly>
    </div>
  </v-app-bar>
</template>

<style scoped>
/* ---------- Barra base ---------- */
.navbar{
  background: linear-gradient(90deg,#1e1e2f,#2a2a40) !important;
  border-bottom: 1px solid rgba(0,255,255,.18);
  box-shadow: 0 0 18px rgba(0,255,255,.25);
}
.navbar :deep(.v-toolbar__content){
  gap: 12px;
}

/* IZQ */
.left-wrap{ display:flex; align-items:center; gap:14px; flex-shrink:0; }
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
.center-menu{ display:flex; align-items:center; gap:8px; flex-shrink:0; }
.nav-btn{
  display:inline-flex; align-items:center; gap:6px;
  padding:8px 12px; border-radius:10px;
  color:#c7d2fe; text-decoration:none; font-weight:600;
  transition: background .2s, transform .2s;
}
.nav-btn:hover{ background: rgba(59,130,246,.12); transform: translateY(-1px); }

/* Buscador inline */
.search-wrap{
  position: relative;
  flex: 1 1 220px;
  min-width: 180px;
  max-width: 420px;
  margin: 0 8px;
}
.search-inline{
  display:flex; align-items:center; gap:8px;
  height: 40px;
  padding: 0 10px 0 12px;
  border-radius: 12px;
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.16);
}
.search-ico{ color:#c7d2fe; font-size: 20px; flex-shrink:0; }
.search-input{
  flex:1; min-width:0; height:36px; outline:none; border:none;
  background: transparent; color:#fff; font-size:14px;
}
.search-input::placeholder{ color: rgba(226,232,240,.72); }
.search-dropdown{
  position: absolute;
  top: calc(100% + 8px);
  left: 0; right: 0;
  z-index: 1300;
  overflow: auto;
  max-height: min(60vh, 480px);
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(16, 20, 36, .96);
  box-shadow: 0 12px 28px rgba(0,0,0,.45);
  backdrop-filter: blur(8px);
}

/* DERECHA */
.right-wrap{ display:flex; align-items:center; gap:8px; flex-shrink:0; margin-left: auto; }
.icon-btn{
  width:32px; height:32px; border-radius:10px; display:grid; place-items:center;
  background: rgba(255,255,255,.06);
  color:#e5e7eb; border:1px solid rgba(255,255,255,.08);
  transition: transform .15s, background .15s;
  flex-shrink: 0;
}
.icon-btn:hover{ transform: translateY(-1px); background: rgba(255,255,255,.12); }

/* Avatar */
.avatar{
  background: linear-gradient(135deg,#6d28d9,#4f46e5);
  color:#fff; font-weight:700;
  overflow:hidden;
}

/* Hovers comunes */
.hover-scale{ transition: transform .2s ease; }
.hover-scale:hover{ transform: scale(1.08); }

.fade-enter-active,.fade-leave-active{ transition: opacity .15s ease; }
.fade-enter-from,.fade-leave-to{ opacity:0; }

.result-row{
  display:flex; align-items:center; justify-content:space-between;
  padding:10px 14px; gap:16px; cursor:pointer;
  color:#e5e7eb; border-top:1px solid rgba(255,255,255,.06);
}
.result-row:first-child{ border-top:0; }
.result-row:hover{ background: rgba(59,130,246,.12); }
.result-row .title{ font-weight:700 }
.result-row .sub{ color:#94a3b8; font-size:12px }
.result-row .right{
  display:flex; flex-direction:column; align-items:flex-end; gap:2px;
  flex-shrink:0; text-align:right;
}
.result-row .date{ font-size:12px; font-weight:600; color:#cbd5e1; white-space:nowrap }
.result-row .amount{ font-weight:700; color:#93c5fd }
.result-row.muted{ color:#94a3b8; cursor:default }
.result-row.muted.more{ justify-content:center; font-size:12px }
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
  color: #fff;
}
.user-role {
  font-size: 12px;
  color: #93c5fd;
}

@media (max-width: 1100px) {
  .promo-pill { display: none; }
}
@media (max-width: 760px) {
  .center-menu .nav-btn { padding: 8px; }
  .center-menu .nav-btn :deep(span:not(.iconify)) { display: none; }
  .user-text { display: none; }
  .search-wrap { max-width: none; }
}
</style>

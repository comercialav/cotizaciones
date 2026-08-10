export default defineNuxtPlugin(() => {
  // Versión del bundle actual (leída una vez al arrancar)
  let currentVersion: number | null = null

  async function fetchVersion(): Promise<number | null> {
    try {
      const res = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return null
      const data = await res.json()
      return typeof data.v === 'number' ? data.v : null
    } catch {
      return null
    }
  }

  async function check() {
    const v = await fetchVersion()
    if (v === null) return

    if (currentVersion === null) {
      currentVersion = v
      return
    }

    if (v !== currentVersion) {
      // Nueva versión desplegada → recarga limpia
      window.location.reload()
    }
  }

  // Primera lectura: guardar la versión actual
  check()

  // Comprobar cada 5 minutos
  setInterval(check, 5 * 60 * 1000)
})

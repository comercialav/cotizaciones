export function useAuthFetch() {
  const { $auth } = useNuxtApp()

  async function waitForAuthUser(timeoutMs = 15000) {
    const auth = $auth as import('firebase/auth').Auth
    const current = auth.currentUser
    if (current?.email && !current.isAnonymous) return current

    return new Promise<import('firebase/auth').User>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsub()
        reject(new Error('Sesión no disponible. Recarga la página e inténtalo de nuevo.'))
      }, timeoutMs)

      const unsub = auth.onAuthStateChanged((u) => {
        if (u?.email && !u.isAnonymous) {
          clearTimeout(timeout)
          unsub()
          resolve(u)
        }
      })
    })
  }

  async function authHeaders(): Promise<Record<string, string>> {
    const user = await waitForAuthUser()
    const token = await user.getIdToken()
    return { Authorization: `Bearer ${token}` }
  }

  async function authFetch<T>(url: string, opts: Parameters<typeof $fetch<T>>[1] = {}) {
    const headers = await authHeaders()
    return $fetch<T>(url, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        ...headers,
      },
      timeout: 30000,
    })
  }

  return { authFetch, authHeaders, waitForAuthUser }
}

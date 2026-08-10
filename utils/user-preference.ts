const BOOL_TRUE = '1'

export function readUserBool(key: string, uid?: string | null): boolean {
  if (import.meta.server || !uid) return false
  try {
    return localStorage.getItem(`${key}:${uid}`) === BOOL_TRUE
  } catch {
    return false
  }
}

export function writeUserBool(key: string, uid: string | null | undefined, value: boolean): void {
  if (import.meta.server || !uid) return
  try {
    localStorage.setItem(`${key}:${uid}`, value ? BOOL_TRUE : '0')
  } catch {
    // localStorage no disponible (modo privado, cuota, etc.)
  }
}

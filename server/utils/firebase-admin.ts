import { readFileSync, existsSync } from 'fs'
import { resolve, isAbsolute } from 'path'
import { getApp, initializeApp, cert, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const APP_NAME = 'cotizaciones-admin'
let app: App | null = null

function projectRoot(): string {
  return process.cwd()
}

function resolveAccountPath(pathEnv: string): string {
  if (isAbsolute(pathEnv)) return pathEnv
  return resolve(projectRoot(), pathEnv.replace(/^\.\//, ''))
}

function findServiceAccountFile(explicitPath?: string): string | null {
  const candidates: string[] = []

  if (explicitPath) {
    candidates.push(resolveAccountPath(explicitPath))
  }

  candidates.push(
    resolve(projectRoot(), 'firebase-service-account.json'),
    resolve(projectRoot(), '.firebase-service-account.json'),
  )

  for (const filePath of candidates) {
    if (existsSync(filePath)) return filePath
  }

  return null
}

function loadServiceAccount(explicitPath?: string): Record<string, unknown> | null {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
  if (json) {
    try {
      return JSON.parse(json)
    } catch {
      console.error('[firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON inválido')
    }
  }

  const pathEnv =
    explicitPath?.trim() ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() ||
    ''

  const filePath = findServiceAccountFile(pathEnv || undefined)
  if (!filePath) {
    console.error(
      '[firebase-admin] No se encontró cuenta de servicio.',
      'cwd:', projectRoot(),
      'pathEnv:', pathEnv || '(vacío)',
    )
    return null
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (e) {
    console.error('[firebase-admin] Error leyendo', filePath, e)
    return null
  }
}

export function getAdminApp(): App {
  if (app) return app

  try {
    app = getApp(APP_NAME)
    return app
  } catch {
    // aún no existe la app con nombre fijo
  }

  const config = useRuntimeConfig()
  const projectId = config.firebaseProjectId || config.public.firebaseProjectId
  const serviceAccount = loadServiceAccount(String(config.firebaseServiceAccountPath || ''))

  if (!serviceAccount) {
    throw new Error(
      'Firebase Admin sin credenciales. Coloca firebase-service-account.json en la raíz del proyecto o define FIREBASE_SERVICE_ACCOUNT_PATH en .env.local y reinicia npm run dev.',
    )
  }

  app = initializeApp(
    {
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
      projectId: String(serviceAccount.project_id || projectId || ''),
    },
    APP_NAME,
  )

  return app
}

export function getAdminAuth() {
  return getAuth(getAdminApp())
}

export function getAdminFirestore() {
  return getFirestore(getAdminApp())
}

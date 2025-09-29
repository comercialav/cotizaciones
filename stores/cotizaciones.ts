// filepath: stores/cotizaciones.ts
import { defineStore } from "pinia"
import { useUserStore } from "~/stores/user"
import {
  getFirestore, collection, doc, runTransaction, serverTimestamp, setDoc
} from "firebase/firestore"

type Articulo = {
  articulo: string
  url: string
  unidades: number
  precioCliente: number
  // ahora ambos opcionales para encajar con el formulario
  precioSolicitado?: number
  precioCompetencia?: number
}

type NuevaCotizacion = {
  cliente: string
  tarifa: string
  articulos: Articulo[]
  stockDisponible: boolean
  compradoAntes: boolean
  precioAnterior: number | null
  fechaDecision: string | null
  plazoEntrega: string
  lugarEntrega: string
  comentarioStock: string
  licitacion: boolean
  clienteFinal: string
  precioCompet: number | null
  comentarios: string
  formaPagoActual: string 
  formaPagoSolicitada: string
}



type CotizacionBase = {
  id: string
  estado?: string | null
  workflow?: string | null
  progress?: number | null
}


type FiltroClave = 'Cotizadas' | 'Ganadas' | 'Perdidas' | 'Reabiertas' | 'SinRevisar'

// reemplaza deriveUI por:
function deriveUI(c: CotizacionBase) {
  const estado = (c.estado || '').toLowerCase()
  const workflow = (c.workflow || '').toLowerCase()

  const isGanada   = estado === 'ganada'
  const isPerdida  = estado === 'perdida'
  const isReab     = estado === 'reabierta'
  const isPend     = !estado || estado === 'pendiente'
  const isCotizada = workflow === 'cotizado'

  // progreso 0/20/40/60/80/100
  let uiProgress = 0
  if (isGanada || isPerdida) uiProgress = 100
  else if (workflow === 'cotizado') uiProgress = 80
  else if (workflow === 'espera_cliente') uiProgress = 60
  else if (workflow === 'consultando') uiProgress = 40
  else if (workflow === 'en_revision') uiProgress = 20
  else uiProgress = 0

  // color por etapa (ajústalos si quieres otros)
  const uiColor =
    isGanada  ? 'green-darken-2' :
    isPerdida ? 'red-darken-2'   :
    workflow === 'cotizado' ? 'blue-darken-2' :
    workflow === 'espera_cliente' ? 'lime-darken-2' :
    workflow === 'consultando' ? 'yellow-darken-2' :
    workflow === 'en_revision' ? 'amber-darken-2' : 'amber-darken-2'

  const uiHidePend = uiProgress === 100

  // etiqueta fina (no agregada)
  const uiFiltro: FiltroClave =
    isGanada   ? 'Ganadas'    :
    isPerdida  ? 'Perdidas'   :
    isCotizada ? 'Cotizadas'  :
    isReab     ? 'Reabiertas' :
    /* else */   'SinRevisar'

  return { uiProgress, uiColor, uiHidePend, uiFiltro }
}

export const useCotizacionesStore = defineStore("cotizaciones", {
  state: () => ({
    saving: false as boolean,
    items: [] as any[],
  }),
    getters: {
      lista(state): any[] {
        return (state.items as any[]).map((c:any) => ({ ...c, ...deriveUI(c) }))
      },
      // agregados
      pendientes(): any[] {
        const l = (this as any).lista
        return l.filter((c:any) => c.uiFiltro === 'Reabiertas' || c.uiFiltro === 'SinRevisar')
      },
      cotizadas(): any[] {
        return (this as any).lista.filter((c:any) => c.uiFiltro === 'Cotizadas')
      },
      ganadas(): any[] {
        return (this as any).lista.filter((c:any) => c.uiFiltro === 'Ganadas')
      },
      perdidas(): any[] {
        return (this as any).lista.filter((c:any) => c.uiFiltro === 'Perdidas')
      },
      // finos
      reabiertas(): any[] {
        return (this as any).lista.filter((c:any) => c.uiFiltro === 'Reabiertas')
      },
      sinRevisar(): any[] {
        return (this as any).lista.filter((c:any) => c.uiFiltro === 'SinRevisar')
      },
    },
  actions: {
  async crearCotizacion(payload: NuevaCotizacion) {
    const user = useUserStore()
    if (!user.uid) throw new Error("No autenticado")

    const cliente = (payload.cliente ?? '').trim()
    const tarifa  = (payload.tarifa  ?? '').trim()
    if (!cliente || !tarifa) throw new Error("Cliente y tarifa son obligatorios")

    // Normalizar líneas SIN dejar undefined
    const articulos = (payload.articulos || []).map(a => {
      const out: any = {
        articulo: (a.articulo ?? '').trim(),
        url: (a.url ?? '').trim(),
        unidades: Number(a.unidades || 0),
        precioCliente: Number(a.precioCliente || 0),
      }
      if (a.precioSolicitado != null) out.precioSolicitado = Number(a.precioSolicitado)
      if (a.precioCompetencia != null) out.precioCompetencia = Number(a.precioCompetencia)
      return out
    })

    this.saving = true
    try {
      const db = getFirestore()

      // === Secuencia mensual ===
      const now = new Date()
      const yyyy = String(now.getFullYear())
      const mm   = String(now.getMonth() + 1).padStart(2, '0')
      const period = `${yyyy}-${mm}`
      const counterRef = doc(db, 'counters', `cotizaciones-${period}`)
      const seq = await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef)
        const cur = (snap.exists() ? (snap.data()?.seq ?? 0) : 0) as number
        const next = cur + 1
        tx.set(counterRef, { seq: next, updatedAt: serverTimestamp() }, { merge: true })
        return next
      })

      const seqStr   = String(seq).padStart(3, '0')          // 001, 002, ...
      const numero = `COT-${period}-${seqStr}`             // COT-2025-09-001

      // IMPORTANTE: construir sin undefined, y mantener FieldValue
      const cotRef = doc(collection(db, "cotizaciones"))
      // --- DEBUG HELPERS ---
function collectUndefinedPaths(obj: any, base = 'root'): string[] {
  const out: string[] = []
  const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v)
  const isArr = Array.isArray
  const walk = (v: any, p: string) => {
    if (v === undefined) { out.push(p); return }
    if (v === null) return
    if (isArr(v)) {
      v.forEach((it, i) => walk(it, `${p}[${i}]`))
    } else if (isObj(v)) {
      for (const k of Object.keys(v)) {
        walk(v[k], `${p}.${k}`)
      }
    }
  }
  walk(obj, base)
  return out
}
// --- FIN DEBUG HELPERS ---

console.log('[STORE] payload recibido:', JSON.parse(JSON.stringify(payload)))
console.log('[STORE] articulos normalizados:', articulos)

const data: any = {
  numero,
  fechaCreacion: serverTimestamp(),
  updatedAt: serverTimestamp(),
  vendedor: {
    uid: user.uid,
    nombre: user.nombre || null,
    email: user.email || null,
  },
  cliente,
  tarifa,
  articulos,
  stockDisponible: !!payload.stockDisponible,
  compradoAntes: !!payload.compradoAntes,
  precioAnterior: payload.precioAnterior ?? null,
  fechaDecision: payload.fechaDecision ?? null,
  plazoEntrega: payload.plazoEntrega || "",
  lugarEntrega: payload.lugarEntrega || "",
  comentarioStock: payload.comentarioStock || "",
  formaPagoActual: payload.formaPagoActual || "",
  formaPagoSolicitada: payload.formaPagoSolicitada || "",
  licitacion: !!payload.licitacion,
  clienteFinal: payload.licitacion ? (payload.clienteFinal || "") : "",
  comentariosCliente: payload.comentarios || "",
  estado: "pendiente",
}

if (payload.precioCompet != null) data.precioCompetencia = Number(payload.precioCompet)

const undefPaths = collectUndefinedPaths(data)
if (undefPaths.length) {
  console.error('[STORE] Campos undefined detectados en `data` antes de setDoc:', undefPaths)
  console.log('[STORE] Dump `data` sin sentinels:', JSON.parse(JSON.stringify({
    ...data,
    fechaCreacion: 'serverTimestamp()',
    updatedAt: 'serverTimestamp()',
  })))
  throw new Error('Hay campos undefined en `data`. Revisa consola para rutas.')
}

console.log('[STORE] OK sin undefined. setDoc -> cotizaciones')
await setDoc(cotRef, data)

      await $fetch("/api/notify", {
        method: "POST",
        body: {
          action: "solicitud",
          id: cotRef.id,
          numero,
          vendedor: user.nombre || user.email || 'Desconocido',
          resumen: {
            cliente: data.cliente,
            tarifa: data.tarifa,
            articulos: data.articulos,
            stockDisponible: data.stockDisponible,
            licitacion: data.licitacion,
            clienteFinal: data.clienteFinal,
            compradoAntes: data.compradoAntes,
            precioAnterior: data.precioAnterior,
            fechaDecision: data.fechaDecision,
            plazoEntrega: data.plazoEntrega,
            lugarEntrega: data.lugarEntrega ?? "",
            comentarioStock: data.comentarioStock ?? "",
            formaPagoActual: data.formaPagoActual, 
            formaPagoSolicitada: data.formaPagoSolicitada,
            precioCompet: data.precioCompetencia ?? null,
            comentarios: data.comentariosCliente,
            totalCotizado: data.articulos.reduce(
              (a: number, r: any) => a + (r.unidades || 0) * (r.precioSolicitado || 0),
              0
            ),
          },
          destinatarios: {
            comercial: user.email,
            supervisor: "vanessa@comercialav.com", 
          },
        },
      })

      return { id: cotRef.id, numero }
    } finally {
      this.saving = false
    }
  },
}

})

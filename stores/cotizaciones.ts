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
  precioCotizado: number
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
  formaPagoSolicitada: string       
}

export const useCotizacionesStore = defineStore("cotizaciones", {
  state: () => ({
    saving: false as boolean,
  }),
  actions: {
    async crearCotizacion(payload: NuevaCotizacion) {
      const user = useUserStore()
      if (!user.uid) throw new Error("No autenticado")
      if (!payload.cliente || !payload.tarifa) throw new Error("Cliente y tarifa son obligatorios")
      console.log("Creando cotización...");
      this.saving = true
      try {
        const db = getFirestore()

        // 1) Secuencia anual atómica
        const year = new Date().getFullYear().toString()
        const counterRef = doc(db, "counters", `cotizaciones-${year}`)
        const seq = await runTransaction(db, async (tx) => {
          const snap = await tx.get(counterRef)
          let current = 0
          if (snap.exists()) current = (snap.data()?.seq ?? 0) as number
          const next = current + 1
          tx.set(counterRef, { seq: next }, { merge: true })
          return next
        })
        const numero = `${year}-${String(seq).padStart(4, "0")}`

        // 2) Crear documento
        const cotRef = doc(collection(db, "cotizaciones"))
        const data = {
          numero,
          fechaCreacion: serverTimestamp(),
          updatedAt: serverTimestamp(),            
          vendedor: {
            uid: user.uid,
            nombre: user.nombre,
            email: user.email,
          },
          cliente: payload.cliente,
          tarifa: payload.tarifa,
          articulos: payload.articulos,

          // Campos adicionales
          stockDisponible: payload.stockDisponible,
          compradoAntes: payload.compradoAntes,
          precioAnterior: payload.precioAnterior ?? null,
          fechaDecision: payload.fechaDecision ?? null,
          plazoEntrega: payload.plazoEntrega || "",
          lugarEntrega: payload.lugarEntrega || "",
          comentarioStock: payload.comentarioStock || "",
          formaPagoSolicitada: payload.formaPagoSolicitada || "",
          licitacion: payload.licitacion,
          clienteFinal: payload.licitacion ? payload.clienteFinal : "",
          precioCompetencia: payload.precioCompet ?? null,
          comentariosCliente: payload.comentarios || "",

          estado: "pendiente", // pendiente | resuelta | reabierta
        }
        await setDoc(cotRef, data)

        // 3) Notificación por email (Nuxt server API)
        await $fetch("/api/notify", {
          method: "POST",
          body: {
            id: cotRef.id,
            numero,
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
              formaPagoSolicitada: data.formaPagoSolicitada,
              precioCompet: data.precioCompetencia,
              comentarios: data.comentariosCliente,
              totalCotizado: data.articulos.reduce(
                (a, r) => a + (r.unidades || 0) * (r.precioCotizado || 0),
                0
              ),
            },
            destinatarios: {
              vendedor: user.email,
              vanessa: "vanessa@comercialav.com", // ajusta si es otro
            },
          },
        })

        return { id: cotRef.id, numero }
      } finally {
        this.saving = false
      }
    },
  },
})

// plugins/initUser.client.ts
import { useUserStore } from "~/stores/user"
export default defineNuxtPlugin(() => {
  const user = useUserStore()
  console.log("[initUser] Plugin cargado, inicializando usuario…")
  user.initUser()
})

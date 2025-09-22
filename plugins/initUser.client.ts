import { useUserStore } from '~/stores/user'
export default defineNuxtPlugin(async () => {
  const user = useUserStore()
  await user.initUser()   // importante: await
})
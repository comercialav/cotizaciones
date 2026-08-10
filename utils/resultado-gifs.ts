/** GIFs de celebración al marcar una cotización como ganada */
export const GANADA_GIFS = [
  'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif',
  'https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExMjc4cm9tM3B1ZGw3MjNmOXlkMzc2NjQzY2Rtb2xpeDRtaGk5OG1xZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/IIY3iOGa15ZOKiMiKg/giphy.gif',
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExYWltZ21nY25mMmU4c3lhbmJveG53a2drMzhpMjRmcDliczV4Z3dxOCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/IwAZ6dvvvaTtdI8SD5/giphy.gif',
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExN20zbGRhOTZ2MTI5NDhxeDZhNmdnODFkN2FqemVxa3F0YXR6cHJoMyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/PklKBQ4bj7XXRHByqs/giphy.gif',
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExZHpsd3EzMXloYWdtcDBsaHExaHFqa21yZXUzMG9xNmhqODVmb2F1MiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/s2qXK8wAvkHTO/giphy.gif',
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExZHpsd3EzMXloYWdtcDBsaHExaHFqa21yZXUzMG9xNmhqODVmb2F1MiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/lsJCkIKV6AT28/giphy.gif',
] as const

/** GIFs al marcar una cotización como perdida */
export const PERDIDA_GIFS = [
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExcWVpdzFzZ21kZnk4ODBjM3E2cHNzcDRnMWE5NHFpZDVpY292azZwdSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/4V3RuU0zSq1SC8Hh4x/giphy.gif',
  'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdDAwNWU1N3F3aGh4dG1lbjdscXA3ZTdzcXZ4ajFuYnU5b2c4bnNiOCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/l1KVaj5UcbHwrBMqI/giphy.gif',
  'https://media.giphy.com/media/v1.Y2lkPWVjZjA1ZTQ3dXkwdXNwbmUwa3JndDBmN3NzcTVtbm9ieHV6bDRuZm0wbjZ1cnNhMCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/T1WqKkLY753dZghbu6/giphy.gif',
  'https://media.giphy.com/media/v1.Y2lkPWVjZjA1ZTQ3ZmNhdW1jY2RsMTUyMzEwamoxMXNjeDl1eDFjbm5lNTdibWllNm8xaSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/JsbMT1336ZJYh9CDz8/giphy.gif',
] as const

export type ResultadoGifKind = 'ganada' | 'perdida'

export function pickRandomGif(kind: ResultadoGifKind): string {
  const list = kind === 'ganada' ? GANADA_GIFS : PERDIDA_GIFS
  return list[Math.floor(Math.random() * list.length)]
}

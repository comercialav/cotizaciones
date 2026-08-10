import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dest = resolve(__dirname, '../public/version.json')

writeFileSync(dest, JSON.stringify({ v: Date.now() }))
console.log('[write-version] version.json generado ✓')

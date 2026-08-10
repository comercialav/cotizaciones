import { cpSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = resolve(__dirname, '../node_modules/tinymce')
const dest = resolve(__dirname, '../public/tinymce')

if (!existsSync(src)) {
  console.warn('[copy-tinymce] tinymce not found in node_modules, skipping.')
  process.exit(0)
}

if (existsSync(dest)) {
  console.log('[copy-tinymce] public/tinymce already exists, skipping.')
  process.exit(0)
}

mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log('[copy-tinymce] Copied tinymce assets to public/tinymce ✓')

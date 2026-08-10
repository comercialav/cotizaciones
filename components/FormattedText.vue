<script setup lang="ts">
import { computed } from 'vue'
import { formatTextForDisplay, looksLikeHtml } from '~/utils/format-text'

const props = withDefaults(defineProps<{
  text?: string | null
  empty?: string
}>(), {
  text: '',
  empty: '—',
})

const html = computed(() => {
  const value = String(props.text || '').trim()
  if (!value) return ''
  return formatTextForDisplay(value)
})

const isHtmlContent = computed(() => looksLikeHtml(String(props.text || '')))
</script>

<template>
  <div
    v-if="html"
    class="formatted-text"
    :class="{ 'formatted-text--html': isHtmlContent }"
    v-html="html"
  />
  <span v-else class="formatted-text formatted-text--empty">{{ empty }}</span>
</template>

<style scoped>
.formatted-text {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
  line-height: 1.55;
  color: #0f172a;
  white-space: pre-wrap;
  word-break: break-word;
}
.formatted-text--html {
  white-space: normal;
}
.formatted-text :deep(a) {
  color: #2563eb;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.formatted-text :deep(a:hover) {
  color: #1d4ed8;
}
.formatted-text :deep(table) {
  width: 100%;
  max-width: 100%;
  border-collapse: collapse;
  margin: 0.5rem 0;
  font-size: 0.85rem;
}
.formatted-text :deep(td),
.formatted-text :deep(th) {
  border: 1px solid #cbd5e1;
  padding: 6px 8px;
  vertical-align: top;
}
.formatted-text :deep(th) {
  background: #f1f5f9;
  font-weight: 600;
}
.formatted-text :deep(ul),
.formatted-text :deep(ol) {
  margin: 0.35rem 0;
  padding-left: 1.25rem;
}
.formatted-text :deep(p) {
  margin: 0 0 0.5rem;
}
.formatted-text :deep(p:last-child) {
  margin-bottom: 0;
}
.formatted-text--empty {
  color: #94a3b8;
}
</style>

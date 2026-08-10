<script setup lang="ts">
import Editor from '@tinymce/tinymce-vue'

const model = defineModel<string>({ default: '' })

const props = withDefaults(defineProps<{
  placeholder?: string
  minHeight?: number
  disabled?: boolean
}>(), {
  placeholder: '',
  minHeight: 280,
  disabled: false,
})

// Espera a que window.tinymce esté disponible (cargado via <head> en nuxt.config)
const ready = ref(false)
onMounted(() => {
  const check = () => {
    if ((window as any).tinymce) {
      ready.value = true
    } else {
      setTimeout(check, 50)
    }
  }
  check()
})

const init = {
  base_url: '/tinymce',
  suffix: '.min',
  height: props.minHeight,
  menubar: false,
  statusbar: true,
  branding: false,
  promotion: false,
  resize: true,
  placeholder: props.placeholder,
  license_key: 'gpl',
  plugins: 'lists link table code wordcount autolink advlist searchreplace preview paste',
  toolbar:
    'undo redo | code removeformat | ' +
    'blocks | bold italic underline strikethrough | ' +
    'alignleft aligncenter alignright alignjustify | ' +
    'bullist numlist outdent indent | ' +
    'forecolor backcolor | ' +
    'table | link | ' +
    'preview searchreplace',
  toolbar_mode: 'wrap',
  block_formats: 'Párrafo=p; Encabezado 2=h2; Encabezado 3=h3; Encabezado 4=h4',
  table_toolbar:
    'tableprops tabledelete | tableinsertrowbefore tableinsertrowafter tabledeleterow | ' +
    'tableinsertcolbefore tableinsertcolafter tabledeletecol | tablecellprops',
  table_default_attributes: { border: '1' },
  table_default_styles: { 'border-collapse': 'collapse', width: '100%' },

  // Pegado desde Outlook/Word: conservar estilos de tabla y colores de celda
  paste_as_text: false,
  paste_merge_formats: true,
  paste_retain_style_properties: 'all',
  paste_webkit_styles: 'all',
  paste_word_valid_elements:
    'b,strong,i,em,h1,h2,h3,h4,h5,h6,p,ol,ul,li,a,sub,sup,strike,br,del,table,thead,tbody,tfoot,tr,td,th,div,span',
  smart_paste: false,

  valid_elements:
    'p,br,strong/b,em/i,u,s/strike,span[style],div[style],' +
    'h1,h2,h3,h4,h5,h6,' +
    'ul,ol,li,' +
    'a[href|target|rel|title],' +
    'table[border|cellpadding|cellspacing|width|style|class],thead,tbody,tfoot,tr,' +
    'td[colspan|rowspan|width|height|align|valign|style|bgcolor|class],' +
    'th[colspan|rowspan|width|height|align|valign|style|bgcolor|class]',
  extended_valid_elements:
    'span[style|class],td[style|bgcolor|background-color],th[style|bgcolor],table[style|class]',
  content_style: `
    body {
      font-family: Roboto, system-ui, -apple-system, sans-serif;
      font-size: 14px;
      line-height: 1.55;
      color: #0f172a;
    }
    table { border-collapse: collapse; max-width: 100%; }
    td, th { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: top; }
    td[bgcolor], th[bgcolor] { background-color: attr(bgcolor); }
  `,
}
</script>

<template>
  <div class="rich-text-editor" :class="{ 'rich-text-editor--disabled': disabled }">
    <Editor
      v-if="ready"
      v-model="model"
      :init="init"
      license-key="gpl"
      :disabled="disabled"
    />
    <div v-else class="rich-text-editor__skeleton" :style="{ minHeight: props.minHeight + 'px' }" />
  </div>
</template>

<style scoped>
.rich-text-editor :deep(.tox-tinymce) {
  border-radius: 8px;
  border-color: rgba(0, 0, 0, 0.24);
}
.rich-text-editor :deep(.tox .tox-edit-area__iframe) {
  background: #fff;
}
.rich-text-editor--disabled :deep(.tox-tinymce) {
  opacity: 0.72;
}
.rich-text-editor__skeleton {
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.24);
  background: #f8f9fa;
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}
@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>

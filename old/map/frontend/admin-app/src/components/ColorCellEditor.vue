<script setup>
import { ref, watch } from 'vue'
import ColorPicker from 'primevue/colorpicker'

const props = defineProps({
  modelValue: { type: String, default: '#888888' },
})
const emit = defineEmits(['update:modelValue'])

const hex = ref((props.modelValue || '#888888').replace('#', ''))
watch(
  () => props.modelValue,
  (v) => {
    hex.value = (v || '#888888').replace('#', '')
  },
)

function onChange(v) {
  hex.value = v
  emit('update:modelValue', '#' + v)
}
</script>

<template>
  <div class="color-cell-editor">
    <ColorPicker :modelValue="hex" format="hex" @update:modelValue="onChange" />
    <span class="color-dot" :style="{ background: '#' + hex }"></span>
    <span class="color-label">#{{ hex }}</span>
  </div>
</template>

<style scoped>
.color-cell-editor {
  display: flex;
  align-items: center;
  gap: 8px;
}
.color-dot {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
}
.color-label {
  font-family: monospace;
  font-size: 12px;
  color: var(--p-text-muted-color);
}
</style>

<script setup>
import { ref, watch } from 'vue'
import AutoComplete from 'primevue/autocomplete'

const props = defineProps({
  options: { type: Array, default: () => [] },
})
const model = defineModel({ default: null })
const filtered = ref([])

// PrimeVue 4's AutoComplete doesn't honor `optionValue` (still a TODO in its
// source) — selecting a suggestion sets v-model to the whole {value,label}
// option object. Edit a plain string buffer ourselves and only let
// `option-select` (which gives us the chosen option directly) write the
// actual tag back to the real model.
const text = ref(model.value ?? '')
watch(model, (v) => {
  text.value = v ?? ''
})
watch(text, (v) => {
  model.value = v || null
})

function onComplete(e) {
  const q = (e.query || '').toLowerCase()
  filtered.value = q
    ? props.options
        .filter((o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q))
        .slice(0, 25)
    : props.options.slice(0, 25)
}

function onOptionSelect(e) {
  text.value = e.value.value
}
</script>

<template>
  <AutoComplete
    v-model="text"
    :suggestions="filtered"
    optionLabel="value"
    dropdown
    fluid
    placeholder="—"
    @complete="onComplete"
    @option-select="onOptionSelect"
  >
    <template #option="{ option }">
      <span class="ac-tag">{{ option.value }}</span>
      <span class="ac-label">{{ option.label }}</span>
    </template>
  </AutoComplete>
</template>

<style scoped>
.ac-tag {
  font-family: monospace;
  margin-right: 8px;
}
.ac-label {
  color: var(--p-text-muted-color);
  font-size: 12px;
}
</style>

<script setup>
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import Button from 'primevue/button'

defineProps({
  title: { type: String, default: 'Провинция' },
  countryOpts: { type: Array, default: () => [] },
})
const emit = defineEmits(['save'])

const visible = defineModel('visible', { default: false })
const owner = defineModel('owner', { default: null })
const occupier = defineModel('occupier', { default: null })

function save() {
  emit('save', { owner: owner.value, occupied_by: occupier.value })
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="title" style="width: 380px">
    <div class="form-row">
      <label>Владелец</label>
      <Select
        v-model="owner"
        :options="countryOpts"
        optionLabel="label"
        optionValue="value"
        showClear
        fluid
        filter
        placeholder="— нет —"
      />
    </div>
    <div class="form-row">
      <label>Оккупант</label>
      <Select
        v-model="occupier"
        :options="countryOpts"
        optionLabel="label"
        optionValue="value"
        showClear
        fluid
        filter
        placeholder="— нет —"
      />
    </div>
    <template #footer>
      <Button label="Отмена" severity="secondary" text @click="visible = false" />
      <Button label="Сохранить" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
.form-row label {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
  letter-spacing: 0.04em;
}
</style>

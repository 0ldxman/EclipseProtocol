<script setup>
import { onMounted } from 'vue'
import { useToast } from 'primevue/usetoast'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import { useCatalogStore } from '../stores/catalog'
import ColorCellEditor from '../components/ColorCellEditor.vue'

const store = useCatalogStore()
const toast = useToast()

onMounted(() => {
  if (!store.loaded) store.fetchAll()
})

async function onCellEditComplete(e) {
  const { data, newValue, field } = e
  if (newValue === data[field]) return
  try {
    await store.updateSide(data.tag, { [field]: newValue })
    toast.add({ severity: 'success', summary: 'Сохранено', life: 2000 })
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Ошибка', detail: err.message, life: 3000 })
  }
}
</script>

<template>
  <div class="table-page">
    <div class="table-toolbar">
      <h2>Стороны</h2>
    </div>
    <DataTable
      :value="store.sides"
      editMode="cell"
      dataKey="tag"
      class="p-datatable-sm"
      @cell-edit-complete="onCellEditComplete"
    >
      <Column field="tag" header="Тег" style="width: 100px">
        <template #body="{ data }"><span class="tag-badge">{{ data.tag }}</span></template>
      </Column>
      <Column field="label" header="Название">
        <template #body="{ data }">{{ data.label }}</template>
        <template #editor="{ data, field }">
          <InputText v-model="data[field]" autofocus fluid />
        </template>
      </Column>
      <Column field="color" header="Цвет" style="width: 160px">
        <template #body="{ data }">
          <div class="color-cell-view">
            <span class="color-dot" :style="{ background: data.color }"></span>
            <span class="color-label">{{ data.color }}</span>
          </div>
        </template>
        <template #editor="{ data, field }">
          <ColorCellEditor v-model="data[field]" />
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<style scoped>
.table-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.table-toolbar {
  padding: 10px 16px;
  border-bottom: 1px solid var(--p-content-border-color);
}
.table-toolbar h2 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
.tag-badge {
  background: var(--p-highlight-background);
  padding: 2px 8px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
}
.color-cell-view {
  display: flex;
  align-items: center;
  gap: 8px;
}
.color-dot {
  width: 14px;
  height: 14px;
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

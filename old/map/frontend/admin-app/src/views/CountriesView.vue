<script setup>
import { computed, onMounted, reactive, ref, watchEffect } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { useCatalogStore } from '../stores/catalog'
import { usePasteGrid } from '../composables/usePasteGrid'
import ColorCellEditor from '../components/ColorCellEditor.vue'
import CountryRefCellEditor from '../components/CountryRefCellEditor.vue'

const store = useCatalogStore()
const toast = useToast()
const confirm = useConfirm()
const pasteGrid = usePasteGrid()

onMounted(() => {
  if (!store.loaded) store.fetchAll()
})

// ── sorting ──────────────────────────────────────────────
const sortState = ref({ col: 'tag', dir: 1 })
function sortBy(col) {
  if (sortState.value.col === col) sortState.value.dir *= -1
  else sortState.value = { col, dir: 1 }
}
function arrow(col) {
  if (sortState.value.col !== col) return ''
  return sortState.value.dir === 1 ? ' ▲' : ' ▼'
}

// While a cell in the active sort column is being edited, its live value
// would otherwise reshuffle the row out from under the cursor on every
// keystroke. Freeze that one row's sort key to its pre-edit snapshot until
// the edit commits, then let it jump to its new position.
let editingTag = null
let editingSortSnapshot = null

const sortedCountries = computed(() => {
  const { col, dir } = sortState.value
  const keyOf = (c) => (c.tag === editingTag ? editingSortSnapshot : c[col])
  return [...store.countries].sort((a, b) => {
    const av = keyOf(a)
    const bv = keyOf(b)
    if (av === bv) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return av.toLowerCase() < bv.toLowerCase() ? -dir : dir
  })
})

const sideOpts = computed(() => store.sides.map((s) => ({ value: s.tag, label: s.label })))
const countryOpts = computed(() =>
  store.countries.map((c) => ({ value: c.tag, label: c.current_name || c.name })),
)

// ── paste grid registration ─────────────────────────────
const COLUMN_INDEX = { name: 0, current_name: 1, color: 2, part_of: 3, side: 4, sympathy: 5 }
const PASTE_FIELDS = new Set(['name', 'current_name', 'part_of'])

watchEffect(() => {
  pasteGrid.reset()
  sortedCountries.value.forEach((c, ri) => {
    pasteGrid.register(ri, 0, (v) => store.updateCountry(c.tag, { name: v }))
    pasteGrid.register(ri, 1, (v) => store.updateCountry(c.tag, { current_name: v || null }))
    pasteGrid.register(ri, 2, (v) => {
      const hex = v.startsWith('#') ? v : '#' + v
      if (!/^#[0-9a-f]{6}$/i.test(hex)) return Promise.resolve()
      return store.updateCountry(c.tag, { color: hex })
    })
    pasteGrid.register(ri, 3, (v) => store.updateCountry(c.tag, { part_of: v || null }))
    pasteGrid.register(ri, 4, (v) => store.updateCountry(c.tag, { side: v || null }))
    pasteGrid.register(ri, 5, (v) => store.updateCountry(c.tag, { sympathy: v || null }))
  })
})

const activeEdit = ref(null)
let editOriginalValue = null

function onCellEditInit(e) {
  activeEdit.value = { rowIndex: e.index, field: e.field }
  editOriginalValue = e.data[e.field]
  if (e.field === sortState.value.col) {
    editingTag = e.data.tag
    editingSortSnapshot = e.data[sortState.value.col]
  }
}

function clearEditingFreeze() {
  editingTag = null
  editingSortSnapshot = null
}

async function onCellEditComplete(e) {
  const { data, newValue, field } = e
  clearEditingFreeze()
  if (newValue === editOriginalValue) return
  try {
    await store.updateCountry(data.tag, { [field]: newValue })
    toast.add({ severity: 'success', summary: 'Сохранено', life: 2000 })
  } catch (err) {
    data[field] = editOriginalValue
    toast.add({ severity: 'error', summary: 'Ошибка', detail: err.message, life: 3000 })
  }
}

async function onPaste(event) {
  if (!activeEdit.value) return
  const { rowIndex, field } = activeEdit.value
  if (!PASTE_FIELDS.has(field)) return
  const colIndex = COLUMN_INDEX[field]
  const result = await pasteGrid.handlePaste(event, rowIndex, colIndex)
  if (result) {
    toast.add({ severity: 'success', summary: `Вставлено ${result.count} ячеек`, life: 2200 })
  }
}

function confirmDelete(c) {
  confirm.require({
    message: `Удалить ${c.tag}?`,
    header: 'Подтверждение',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Удалить',
    rejectLabel: 'Отмена',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await store.deleteCountry(c.tag)
        toast.add({ severity: 'success', summary: 'Удалено', life: 2000 })
      } catch (err) {
        toast.add({ severity: 'error', summary: 'Ошибка', detail: err.message, life: 3000 })
      }
    },
  })
}

// ── add row ──────────────────────────────────────────────
const newCountry = reactive({
  tag: '',
  name: '',
  current_name: '',
  color: '#888888',
  part_of: null,
  side: null,
  sympathy: null,
})

function onTagInput(e) {
  newCountry.tag = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '')
}

async function addCountry() {
  if (!newCountry.tag || !newCountry.name) {
    toast.add({ severity: 'error', summary: 'Нужны тег и название', life: 2500 })
    return
  }
  try {
    await store.createCountry({
      ...newCountry,
      current_name: newCountry.current_name || null,
    })
    toast.add({ severity: 'success', summary: 'Добавлено', life: 2000 })
    Object.assign(newCountry, {
      tag: '',
      name: '',
      current_name: '',
      color: '#888888',
      part_of: null,
      side: null,
      sympathy: null,
    })
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Ошибка', detail: err.message, life: 3000 })
  }
}
</script>

<template>
  <div class="table-page">
    <div class="table-toolbar">
      <h2>Страны <small>({{ store.countries.length }})</small></h2>
      <small class="hint"
        >Клик по ячейке — редактировать · Enter/клик мимо — сохранить · Ctrl+V в ячейке —
        вставить из Excel</small
      >
    </div>

    <div class="add-row">
      <InputText :modelValue="newCountry.tag" placeholder="TAG" class="mono" @input="onTagInput" />
      <InputText v-model="newCountry.name" placeholder="Название" />
      <InputText v-model="newCountry.current_name" placeholder="Текущее имя" />
      <ColorCellEditor v-model="newCountry.color" />
      <CountryRefCellEditor v-model="newCountry.part_of" :options="countryOpts" />
      <Select
        v-model="newCountry.side"
        :options="sideOpts"
        optionLabel="label"
        optionValue="value"
        showClear
        placeholder="Фракция"
      />
      <Select
        v-model="newCountry.sympathy"
        :options="sideOpts"
        optionLabel="label"
        optionValue="value"
        showClear
        placeholder="Симпатия"
      />
      <Button icon="pi pi-plus" rounded text severity="success" @click="addCountry" />
    </div>

    <DataTable
      :value="sortedCountries"
      editMode="cell"
      dataKey="tag"
      class="p-datatable-sm"
      @cell-edit-init="onCellEditInit"
      @cell-edit-complete="onCellEditComplete"
      @paste.capture="onPaste"
    >
      <Column field="tag" style="width: 90px">
        <template #header
          ><span class="sortable-th" @click="sortBy('tag')">Тег{{ arrow('tag') }}</span></template
        >
        <template #body="{ data }"><span class="tag-badge">{{ data.tag }}</span></template>
      </Column>

      <Column field="name" style="width: 160px">
        <template #header
          ><span class="sortable-th" @click="sortBy('name')">Название{{ arrow('name') }}</span></template
        >
        <template #body="{ data }">{{ data.name }}</template>
        <template #editor="{ data, field }"><InputText v-model="data[field]" autofocus fluid /></template>
      </Column>

      <Column field="current_name" header="Текущее имя" style="width: 160px">
        <template #body="{ data }"
          ><span :class="{ 'null-val': !data.current_name }">{{ data.current_name || '—' }}</span></template
        >
        <template #editor="{ data, field }"><InputText v-model="data[field]" autofocus fluid /></template>
      </Column>

      <Column field="color" header="Цвет" style="width: 150px">
        <template #body="{ data }">
          <div class="color-cell-view">
            <span class="color-dot" :style="{ background: data.color }"></span>
            <span class="color-label">{{ data.color }}</span>
          </div>
        </template>
        <template #editor="{ data, field }"><ColorCellEditor v-model="data[field]" /></template>
      </Column>

      <Column field="part_of" style="width: 140px">
        <template #header
          ><span class="sortable-th" @click="sortBy('part_of')">Часть{{ arrow('part_of') }}</span></template
        >
        <template #body="{ data }">
          <span v-if="data.part_of" class="tag-badge">{{ data.part_of }}</span>
          <span v-else class="null-val">—</span>
        </template>
        <template #editor="{ data, field }">
          <CountryRefCellEditor v-model="data[field]" :options="countryOpts" />
        </template>
      </Column>

      <Column field="side" style="width: 120px">
        <template #header
          ><span class="sortable-th" @click="sortBy('side')">Фракция{{ arrow('side') }}</span></template
        >
        <template #body="{ data }">
          <span v-if="data.side" class="tag-badge">{{ data.side }}</span>
          <span v-else class="null-val">—</span>
        </template>
        <template #editor="{ data, field }">
          <Select
            v-model="data[field]"
            :options="sideOpts"
            optionLabel="label"
            optionValue="value"
            showClear
            fluid
            autofocus
          />
        </template>
      </Column>

      <Column field="sympathy" header="Симпатия" style="width: 120px">
        <template #body="{ data }">
          <span v-if="data.sympathy" class="tag-badge">{{ data.sympathy }}</span>
          <span v-else class="null-val">—</span>
        </template>
        <template #editor="{ data, field }">
          <Select
            v-model="data[field]"
            :options="sideOpts"
            optionLabel="label"
            optionValue="value"
            showClear
            fluid
            autofocus
          />
        </template>
      </Column>

      <Column style="width: 50px">
        <template #body="{ data }">
          <Button icon="pi pi-times" rounded text severity="danger" @click="confirmDelete(data)" />
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
  overflow: hidden;
}
.table-toolbar {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--p-content-border-color);
  flex-shrink: 0;
}
.table-toolbar h2 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
.table-toolbar .hint {
  color: var(--p-text-muted-color);
  font-size: 11px;
}
.add-row {
  display: grid;
  grid-template-columns: 90px 160px 160px 150px 140px 120px 120px 50px;
  gap: 8px;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--p-content-border-color);
  background: var(--p-content-background);
  flex-shrink: 0;
}
.add-row .mono {
  font-family: monospace;
}
:deep(.p-datatable) {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
:deep(.p-datatable-table-container) {
  overflow: auto;
}
.tag-badge {
  background: var(--p-highlight-background);
  padding: 2px 8px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
}
.null-val {
  color: var(--p-text-muted-color);
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
.sortable-th {
  cursor: pointer;
  user-select: none;
}
.sortable-th:hover {
  color: var(--p-primary-color);
}
</style>

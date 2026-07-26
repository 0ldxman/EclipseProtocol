<script setup>
import { ref } from 'vue'
import Toast from 'primevue/toast'
import ConfirmDialog from 'primevue/confirmdialog'
import MapView from './views/MapView.vue'
import CountriesView from './views/CountriesView.vue'
import SidesView from './views/SidesView.vue'

const tabs = [
  { key: 'map', label: 'Карта' },
  { key: 'countries', label: 'Страны' },
  { key: 'sides', label: 'Стороны' },
]
const activeTab = ref('map')
</script>

<template>
  <div class="app-shell">
    <nav>
      <div
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </div>
    </nav>

    <div class="page-host">
      <div v-show="activeTab === 'map'" class="page"><MapView /></div>
      <div v-show="activeTab === 'countries'" class="page"><CountriesView /></div>
      <div v-show="activeTab === 'sides'" class="page"><SidesView /></div>
    </div>

    <Toast />
    <ConfirmDialog />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}
nav {
  display: flex;
  gap: 2px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--p-content-border-color);
  background: var(--p-content-background);
  flex-shrink: 0;
}
.tab {
  padding: 6px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--p-text-muted-color);
  user-select: none;
}
.tab.active {
  background: var(--p-highlight-background);
  color: var(--p-text-color);
}
.tab:hover:not(.active) {
  color: var(--p-text-color);
}
.page-host {
  flex: 1;
  min-height: 0;
  position: relative;
}
.page {
  position: absolute;
  inset: 0;
}
</style>

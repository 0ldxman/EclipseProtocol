<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { useToast } from 'primevue/usetoast'
import SelectButton from 'primevue/selectbutton'
import { useCatalogStore } from '../stores/catalog'
import * as api from '../api'
import { SITE_ROOT } from '../api'
import ProvinceEditDialog from '../components/ProvinceEditDialog.vue'

const store = useCatalogStore()
const toast = useToast()

const mapContainer = ref(null)
let map = null
let provStates = {}
let countriesByTag = {}
let sidesByTag = {}
const hatchIds = new Set()
const NEUTRAL_LABEL_COLOR = '#888888'
let labelMarkers = []
let labelMeta = []
let rawOccupiedZones = { type: 'FeatureCollection', features: [] }

const modeOptions = [
  { label: 'Страны', value: 'country' },
  { label: 'Стороны', value: 'sides' },
]
const currentMode = ref('country')

const provinceInfo = reactive({
  visible: false,
  shapeName: '',
  fid: null,
  shapeGroup: '',
  owner: '',
  occupiedBy: '',
})

const dialogVisible = ref(false)
const dialogTitle = ref('')
const dialogOwner = ref(null)
const dialogOccupier = ref(null)
let selFid = null

const countryOpts = computed(() =>
  store.countries.map((c) => ({ value: c.tag, label: `${c.tag} — ${c.current_name || c.name}` })),
)

function countryName(tag) {
  const c = countriesByTag[tag]
  if (!c) return tag
  return c.current_name || c.name
}

function hexToRgb(hex) {
  hex = hex.replace('#', '')
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

function lighten(hex, factor) {
  const [r, g, b] = hexToRgb(hex)
  const l = (v) => Math.round(v + (255 - v) * factor)
  return `rgb(${l(r)}, ${l(g)}, ${l(b)})`
}

// Mirrors the backend's country_color_for_mode(): in "sides" mode a
// country's label takes its side's color, or a lightened sympathy color,
// or grey if it's aligned with neither.
function labelColor(tag) {
  // Reverted: colored-by-side labels didn't read well, back to plain white.
  return '#fff'
}

function makeHatchPattern(color) {
  const size = 24
  const spacing = 6
  const thickness = 3
  const [r, g, b] = hexToRgb(color)
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      const v = (x + y) % spacing
      data[idx] = r
      data[idx + 1] = g
      data[idx + 2] = b
      data[idx + 3] = v < thickness ? 230 : 0
    }
  }
  return { width: size, height: size, data }
}

function ensureHatchPattern(color) {
  const id = `hatch-${color.replace('#', '')}`
  if (!hatchIds.has(id)) {
    hatchIds.add(id)
    map.addImage(id, makeHatchPattern(color))
  }
  return id
}

// Google-Maps-style labels: one fixed, crisp font size for every country
// (Google Maps doesn't size-up text for bigger countries either) — no
// rotation, no opacity gradients while visible. But *when* a label appears
// is continuous, not bucketed: each country gets its own minZoom from a
// log-area curve, calibrated against this dataset's real spread (Russia
// ~2700deg² down to Vatican ~0.00004deg²) so countries reveal themselves
// gradually as you zoom in rather than in a few synced waves.

function pickMinZoom(area) {
  const minZoom = 4.4 - 1.3 * Math.log10(area + 1e-7)
  return Math.min(11, Math.max(0, minZoom))
}

function updateLabelTransforms() {
  const zoom = map.getZoom()
  for (const m of labelMeta) {
    m.el.style.opacity = zoom >= m.minZoom ? 1 : 0
  }
}

async function loadBordersAndLabels() {
  const geojson = await api.getMapBorders(currentMode.value)

  const src = map.getSource('country-borders')
  if (src) src.setData(geojson)

  labelMarkers.forEach((m) => m.remove())
  labelMarkers = []
  labelMeta = []
  for (const feat of geojson.features) {
    const { tag, label_lng, label_lat, label_minx, label_maxx, label_miny, label_maxy } = feat.properties
    // Bounding-box area, longitude corrected for latitude (a degree of
    // longitude shrinks toward the poles).
    const area =
      Math.max(0, label_maxx - label_minx) *
      Math.cos((label_lat * Math.PI) / 180) *
      Math.max(0, label_maxy - label_miny)

    const anchorEl = document.createElement('div')
    const inner = document.createElement('div')
    inner.className = 'country-label'
    inner.textContent = countryName(tag)
    inner.style.color = labelColor(tag)
    anchorEl.appendChild(inner)
    const marker = new maplibregl.Marker({ element: anchorEl, anchor: 'center' }).setLngLat([label_lng, label_lat]).addTo(map)
    labelMarkers.push(marker)
    labelMeta.push({ el: inner, minZoom: pickMinZoom(area) })
  }
  updateLabelTransforms()
}

function applyOccupiedOverlay() {
  const features = []
  for (const feat of rawOccupiedZones.features) {
    const st = provStates[feat.properties.fid]
    if (!st || !st.occupier_color) continue
    features.push({
      ...feat,
      properties: { ...feat.properties, occupier_pattern: ensureHatchPattern(st.occupier_color) },
    })
  }
  const src = map.getSource('occupied-zones')
  if (src) src.setData({ type: 'FeatureCollection', features })
}

async function loadOccupiedZones() {
  rawOccupiedZones = await api.getOccupiedZones()
  applyOccupiedOverlay()
}

async function loadMapStates() {
  const data = await api.getMapStates(currentMode.value)
  provStates = data
  Object.entries(data).forEach(([fid, st]) => {
    map.setFeatureState({ source: 'provinces', sourceLayer: 'provinces', id: parseInt(fid) }, { color: st.color })
  })
  applyOccupiedOverlay()
}

function onModeChange() {
  if (!map) return
  loadMapStates()
  loadBordersAndLabels()
}

function withParent(tag, parentTag) {
  if (!tag) return '—'
  return parentTag ? `${tag} (${parentTag})` : tag
}

function onHover(e) {
  const p = e.features[0].properties
  const st = provStates[p.fid] || {}
  provinceInfo.visible = true
  provinceInfo.shapeName = p.shapeName || '—'
  provinceInfo.fid = p.fid
  provinceInfo.shapeGroup = p.shapeGroup
  provinceInfo.owner = withParent(st.owner, st.owner_parent)
  provinceInfo.occupiedBy = withParent(st.occupied_by, st.occupied_by_parent)
  map.getCanvas().style.cursor = 'pointer'
}

function onLeave() {
  provinceInfo.visible = false
  map.getCanvas().style.cursor = ''
}

async function onClick(e) {
  const props = e.features[0].properties
  selFid = props.fid
  if (!store.loaded) await store.fetchAll()
  const st = provStates[selFid] || {}
  dialogTitle.value = props.shapeName || `Провинция #${selFid}`
  dialogOwner.value = st.owner || null
  dialogOccupier.value = st.occupied_by || null
  dialogVisible.value = true
}

async function onDialogSave({ owner, occupied_by }) {
  try {
    await api.updateProvince(selFid, { owner, occupied_by })
    toast.add({ severity: 'success', summary: 'Сохранено', life: 2000 })
    dialogVisible.value = false
    await Promise.all([loadMapStates(), loadBordersAndLabels(), loadOccupiedZones()])
    // Border-line polygons for the affected country finish recomputing on the
    // backend slightly after this response (moved off the request path to
    // keep saving fast) — refetch once more shortly after so the line
    // catches up without the admin having to reload.
    setTimeout(loadBordersAndLabels, 1500)
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Ошибка', detail: err.message, life: 3000 })
  }
}

onMounted(async () => {
  if (!store.loaded) await store.fetchAll()
  store.countries.forEach((c) => (countriesByTag[c.tag] = c))
  store.sides.forEach((s) => (sidesByTag[s.tag] = s))

  const protocol = new Protocol()
  maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol))

  map = new maplibregl.Map({
    container: mapContainer.value,
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        land: { type: 'vector', url: `pmtiles://${SITE_ROOT}geo/land.pmtiles` },
        provinces: {
          type: 'vector',
          url: `pmtiles://${SITE_ROOT}geo/provinces.pmtiles`,
          promoteId: { provinces: 'fid' },
        },
        'country-borders': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        'occupied-zones': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#14181f' } },
        { id: 'land', type: 'fill', source: 'land', 'source-layer': 'land', paint: { 'fill-color': '#242831' } },
        {
          id: 'pf',
          type: 'fill',
          source: 'provinces',
          'source-layer': 'provinces',
          paint: {
            'fill-color': ['coalesce', ['feature-state', 'color'], 'rgba(0,0,0,0)'],
            'fill-opacity': 0.1,
          },
        },
        {
          id: 'oz',
          type: 'fill',
          source: 'occupied-zones',
          paint: {
            'fill-pattern': ['get', 'occupier_pattern'],
            'fill-opacity': 0.2,
          },
        },
        {
          id: 'pb',
          type: 'line',
          source: 'provinces',
          'source-layer': 'provinces',
          paint: { 'line-color': '#000', 'line-width': 0.4, 'line-opacity': 0.5 },
        },
        {
          id: 'lb',
          type: 'line',
          source: 'land',
          'source-layer': 'land',
          paint: { 'line-color': '#3a4250', 'line-width': 0.8 },
        },
        {
          id: 'country-borders-line',
          type: 'line',
          source: 'country-borders',
          paint: { 'line-color': '#e19744', 'line-width': 1.6, 'line-opacity': 0.5 },
        },
      ],
    },
    center: [20, 30],
    zoom: 2,
  })
  map.addControl(new maplibregl.NavigationControl(), 'top-right')
  map.on('load', () => {
    loadOccupiedZones()
    loadMapStates()
    loadBordersAndLabels()
  })
  map.on('zoom', updateLabelTransforms)
  map.on('mousemove', 'pf', onHover)
  map.on('mouseleave', 'pf', onLeave)
  map.on('click', 'pf', onClick)
})

onBeforeUnmount(() => {
  labelMarkers.forEach((m) => m.remove())
  labelMarkers = []
  if (map) {
    map.remove()
    map = null
  }
})
</script>

<template>
  <div class="map-page">
    <div ref="mapContainer" class="map-canvas"></div>
    <aside class="map-sidebar">
      <div>
        <h3>Режим</h3>
        <SelectButton
          v-model="currentMode"
          :options="modeOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
          @change="onModeChange"
        />
      </div>
      <div>
        <h3>Провинция</h3>
        <div v-if="provinceInfo.visible" class="province-info">
          <strong>{{ provinceInfo.shapeName }}</strong>
          fid: {{ provinceInfo.fid }}<br />
          группа: {{ provinceInfo.shapeGroup }}<br />
          владелец: {{ provinceInfo.owner }}<br />
          оккупант: {{ provinceInfo.occupiedBy }}
        </div>
        <div v-else class="province-info muted">Кликни на провинцию</div>
      </div>
    </aside>

    <ProvinceEditDialog
      v-model:visible="dialogVisible"
      v-model:owner="dialogOwner"
      v-model:occupier="dialogOccupier"
      :title="dialogTitle"
      :countryOpts="countryOpts"
      @save="onDialogSave"
    />
  </div>
</template>

<style scoped>
.map-page {
  display: flex;
  height: 100%;
  width: 100%;
}
.map-canvas {
  flex: 1;
  min-width: 0;
}
.map-sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 16px;
  border-left: 1px solid var(--p-content-border-color);
  background: var(--p-content-background);
  overflow-y: auto;
}
.map-sidebar h3 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--p-text-muted-color);
  margin: 0 0 8px;
}
.province-info {
  font-size: 12px;
  line-height: 1.7;
  color: var(--p-text-muted-color);
}
.province-info strong {
  display: block;
  font-size: 13px;
  color: var(--p-text-color);
  margin-bottom: 4px;
}
.province-info.muted {
  color: var(--p-text-muted-color);
}
</style>

<style>
.country-label {
  pointer-events: none;
  font-family: 'JetBrains Mono', 'Courier New', 'Roboto Mono', monospace;
  font-weight: 700;
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #fff;
  text-shadow: 0 0 3px #000, 0 0 3px #000, 1px 1px 1px #000;
  white-space: nowrap;
  display: inline-block;
  transition: opacity 0.2s ease;
}
</style>

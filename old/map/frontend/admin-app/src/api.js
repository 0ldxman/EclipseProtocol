// Resolve relative to the current page so this works whether the app is
// served at the site root, under /admin/, or behind a path-prefixing proxy
// (e.g. an IDE's port-forwarding proxy that rewrites /proxy/<port>/...).
export const SITE_ROOT = new URL('../', window.location.href.replace(/\/?$/, '/')).href
const BASE = SITE_ROOT + 'api'

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await res.text())
  if (res.status === 204) return null
  return res.json()
}

export const getCountries = () => request('GET', '/countries')
export const createCountry = (body) => request('POST', '/countries', body)
export const updateCountry = (tag, body) => request('PUT', `/countries/${tag}`, body)
export const deleteCountry = (tag) => request('DELETE', `/countries/${tag}`)

export const getSides = () => request('GET', '/sides')
export const updateSide = (tag, body) => request('PUT', `/sides/${tag}`, body)

export const getMapStates = (mode) => request('GET', `/map/states?mode=${mode}`)
export const getMapBorders = (mode) => request('GET', `/map/borders?mode=${mode}`)
export const getOccupiedZones = () => request('GET', '/map/occupied-zones')
export const updateProvince = (fid, body) => request('PUT', `/provinces/${fid}`, body)
export const bulkUpdateProvinces = (body) => request('POST', '/provinces/bulk', body)

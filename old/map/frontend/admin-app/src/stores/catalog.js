import { defineStore } from 'pinia'
import * as api from '../api'

export const useCatalogStore = defineStore('catalog', {
  state: () => ({
    countries: [],
    sides: [],
    loaded: false,
  }),
  actions: {
    async fetchAll() {
      const [countries, sides] = await Promise.all([api.getCountries(), api.getSides()])
      this.countries = countries
      this.sides = sides
      this.loaded = true
    },
    async createCountry(payload) {
      const created = await api.createCountry(payload)
      this.countries.push(created)
      return created
    },
    async updateCountry(tag, patch) {
      const updated = await api.updateCountry(tag, patch)
      const idx = this.countries.findIndex((c) => c.tag === tag)
      if (idx !== -1) this.countries[idx] = updated
      return updated
    },
    async deleteCountry(tag) {
      await api.deleteCountry(tag)
      this.countries = this.countries.filter((c) => c.tag !== tag)
    },
    async updateSide(tag, patch) {
      const updated = await api.updateSide(tag, patch)
      const idx = this.sides.findIndex((s) => s.tag === tag)
      if (idx !== -1) this.sides[idx] = updated
      return updated
    },
  },
})

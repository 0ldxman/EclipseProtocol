import { ref } from 'vue'

export function usePasteGrid() {
  const grid = ref([])

  function reset() {
    grid.value = []
  }

  function register(rowIndex, colIndex, setter) {
    if (!grid.value[rowIndex]) grid.value[rowIndex] = {}
    grid.value[rowIndex][colIndex] = setter
  }

  async function handlePaste(event, rowIndex, colIndex) {
    const raw = event.clipboardData.getData('text/plain')
    const rows = raw.split(/\r?\n/).map((r) => r.split('\t'))
    while (rows.length && rows[rows.length - 1].every((v) => !v.trim())) rows.pop()

    if (rows.length === 1 && rows[0].length === 1) return null

    event.preventDefault()
    const saves = []
    rows.forEach((row, ri2) => {
      row.forEach((val, ci2) => {
        const setter = grid.value[rowIndex + ri2]?.[colIndex + ci2]
        const v = val.trim()
        if (setter && v !== '') saves.push(setter(v))
      })
    })
    const results = await Promise.allSettled(saves)
    return { count: saves.length, results }
  }

  return { grid, reset, register, handlePaste }
}

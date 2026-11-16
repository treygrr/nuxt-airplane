// The "keep the catalog offline" setting: when on, the whole catalog is
// fetched in the background after the first page of it. Kept in this
// browser; the GetProducts handler reads the same key.

import { OFFLINE_CATALOG_KEY } from '../lib/airplane'

export function useOfflineCatalog() {
  const enabled = useState('offline-catalog', () => true)
  onMounted(() => {
    try {
      enabled.value = localStorage.getItem(OFFLINE_CATALOG_KEY) !== 'off'
    }
    catch {
      // Storage is blocked: the default stands.
    }
  })
  return computed({
    get: () => enabled.value,
    set: (value: boolean) => {
      enabled.value = value
      try {
        localStorage.setItem(OFFLINE_CATALOG_KEY, value ? 'on' : 'off')
      }
      catch {
        // Not kept past this page.
      }
    },
  })
}

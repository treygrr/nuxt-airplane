declare global {
  interface NuxtAirplaneStores {
    sites: { id: string, name: string, archived: 0 | 1 }
  }
}

export default defineAirplaneStores({ sites: '&id, archived' })

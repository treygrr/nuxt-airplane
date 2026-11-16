<script setup lang="ts">
import { mdiWarehouse } from '@mdi/js'

// Every site's restock cart, one card each, for the sites with something in theirs.
const { lines, loading } = useSiteCartLines()
const { data } = useSites({})
const carts = computed(() => {
  const sites = new Map((data.value?.sites ?? []).map(site => [site.id, site]))
  const bySite = new Map<string, typeof lines.value>()
  for (const line of lines.value) bySite.set(line.siteId, [...(bySite.get(line.siteId) ?? []), line])
  return [...bySite].map(([siteId, siteLines]) => ({ site: sites.get(siteId) ?? { id: siteId, name: 'A site' }, lines: siteLines }))
})
</script>

<template>
  <div>
    <v-skeleton-loader
      v-if="loading && !lines.length"
      type="table-row@4"
    />
    <v-empty-state
      v-else-if="!carts.length"
      :icon="mdiWarehouse"
      title="No restocks waiting"
      text="Add items to a restock cart from a site that tracks inventory."
      action-text="Go to sites"
      to="/inventory"
    />
    <div
      v-else
      class="d-flex flex-column ga-6"
    >
      <SiteCartCard
        v-for="cart in carts"
        :key="cart.site.id"
        :site="cart.site"
        :lines="cart.lines"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { mdiArrowLeft } from '@mdi/js'

// One site: what it holds, and stocking more.
const route = useRoute()
const siteId = computed(() => String(route.params.siteId))
const { data, loading } = useSite(siteId)
const site = computed(() => data.value?.site)
useHead({ title: () => `${site.value?.name ?? 'Site'} · Toolshed` })
</script>

<template>
  <div>
    <v-btn
      :prepend-icon="mdiArrowLeft"
      to="/inventory"
      variant="text"
      class="mb-2"
    >
      Sites
    </v-btn>
    <v-skeleton-loader
      v-if="loading && !site"
      type="heading"
    />
    <div
      v-else-if="site"
      class="mb-4"
    >
      <h1 class="text-headline-medium">
        {{ site.name }}
        <v-chip
          v-if="site.archived"
          size="small"
        >
          Archived
        </v-chip>
      </h1>
      <div class="text-body-medium text-medium-emphasis">
        {{ site.itemCount.toLocaleString() }} items · {{ site.unitCount.toLocaleString() }} units.
        <template v-if="site.archived">
          Its stock does not count towards what the shop can sell.
        </template>
      </div>
    </div>
    <v-empty-state
      v-else
      title="No such site"
      text="It may have been deleted, or it has not been loaded while online."
    />
    <template v-if="site">
      <AddSiteItemForm
        :site-id="siteId"
        class="mb-4"
      />
      <SiteItemsTable :site-id="siteId" />
    </template>
  </div>
</template>

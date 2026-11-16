<script setup lang="ts">
import { mdiMagnify, mdiPlus, mdiWarehouse } from '@mdi/js'

// Inventory management: the sites. Search and the archived filter are query
// variables, answered from the tables offline too.
useHead({ title: 'Sites · Toolshed' })

const search = ref('')
const showArchived = ref(false)
const { data, loading, error } = useSites(() => ({ archived: showArchived.value ? null : false, search: search.value.trim() || null }))
const sites = computed(() => data.value?.sites ?? [])
const pending = usePendingRows('Site')
const inventory = useInventory()

const naming = ref<{ id?: string, name?: string } | null>(null)
function saveName(name: string) {
  if (naming.value?.id) inventory.renameSite.mutate({ id: naming.value.id, name })
  else inventory.createSite.mutate({ name })
}
</script>

<template>
  <div>
    <div class="d-flex align-center flex-wrap ga-3 mb-4">
      <h1 class="text-headline-medium me-auto">
        Sites
      </h1>
      <v-text-field
        v-model="search"
        :prepend-inner-icon="mdiMagnify"
        label="Search sites"
        density="compact"
        max-width="280"
        hide-details
        clearable
      />
      <v-switch
        v-model="showArchived"
        label="Show archived"
        density="compact"
        hide-details
      />
      <v-btn
        :prepend-icon="mdiPlus"
        color="primary"
        @click="naming = {}"
      >
        New site
      </v-btn>
    </div>

    <v-alert
      v-if="error && !sites.length"
      type="warning"
      variant="tonal"
      :text="error.message"
      class="mb-4"
    />
    <v-row v-if="loading && !sites.length">
      <v-col
        v-for="n in 4"
        :key="n"
        cols="12"
        sm="6"
        lg="4"
      >
        <v-skeleton-loader type="list-item-two-line" />
      </v-col>
    </v-row>
    <v-empty-state
      v-else-if="!sites.length"
      :icon="mdiWarehouse"
      title="No sites"
      :text="search ? 'No site matches the search.' : 'Create a site to start keeping stock.'"
    />
    <v-row v-else>
      <v-col
        v-for="site in sites"
        :key="site.id"
        cols="12"
        sm="6"
        lg="4"
      >
        <SiteCard
          :site="site"
          :pending="pending.has(site.id)"
          @rename="naming = site"
          @archive="inventory.archiveSite.mutate({ id: site.id })"
          @unarchive="inventory.unarchiveSite.mutate({ id: site.id })"
          @delete="inventory.deleteSite.mutate({ id: site.id })"
        />
      </v-col>
    </v-row>

    <TextPromptDialog
      :model-value="!!naming"
      :title="naming?.id ? 'Rename site' : 'New site'"
      label="Name"
      :value="naming?.name"
      :action="naming?.id ? 'Rename' : 'Create'"
      @update:model-value="!$event && (naming = null)"
      @submit="saveName"
    />
  </div>
</template>

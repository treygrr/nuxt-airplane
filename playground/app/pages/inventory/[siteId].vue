<script setup lang="ts">
import { mdiArrowLeft, mdiCartArrowDown, mdiCartOutline, mdiChevronDown, mdiPencilOutline, mdiPlus } from '@mdi/js'

// One site: what it holds, adding products, its restock cart, and, where it
// tracks inventory, the levels its items are kept between.
const route = useRoute()
const siteId = computed(() => String(route.params.siteId))
const { data, loading } = useSite(siteId)
const site = computed(() => data.value?.site)
useHead({ title: () => `${site.value?.name ?? 'Site'} · Toolshed` })

const { lines } = useSiteCartLines(siteId)
const cartUnits = computed(() => lines.value.reduce((sum, line) => sum + line.quantity, 0))
const { fillToMax } = useInventory()
const adding = ref(false)
const editing = ref(false)
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
      class="d-flex align-center flex-wrap ga-4 mb-4"
    >
      <div class="me-auto">
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
      <v-menu location="bottom end">
        <template #activator="{ props: menu }">
          <v-btn
            v-bind="menu"
            :append-icon="mdiChevronDown"
            variant="outlined"
          >
            Site options
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item
            :prepend-icon="mdiPencilOutline"
            title="Edit site"
            subtitle="Name, inventory tracking"
            @click="editing = true"
          />
          <v-list-item
            :prepend-icon="mdiCartArrowDown"
            title="Fill all to max"
            :subtitle="site.tracksInventory ? 'Cart what every item needs' : 'Needs inventory tracking'"
            :disabled="!site.tracksInventory || fillToMax.loading.value"
            @click="fillToMax.mutate({ siteId: site.id })"
          />
        </v-list>
      </v-menu>
      <v-btn
        :prepend-icon="mdiCartOutline"
        to="/cart?view=inventory"
        variant="tonal"
      >
        Restock cart
        <v-badge
          v-if="lines.length"
          :content="lines.length"
          color="primary"
          inline
        />
      </v-btn>
      <v-btn
        :prepend-icon="mdiPlus"
        color="primary"
        @click="adding = true"
      >
        Add product
      </v-btn>
    </div>
    <v-empty-state
      v-else
      title="No such site"
      text="It may have been deleted, or it has not been loaded while online."
    />
    <template v-if="site">
      <v-alert
        v-if="lines.length"
        type="info"
        variant="tonal"
        density="compact"
        class="mb-4"
      >
        {{ lines.length }} item{{ lines.length === 1 ? '' : 's' }}, {{ cartUnits.toLocaleString() }} units, in the restock cart. Checking it out adds them to what the site holds.
      </v-alert>
      <SiteItemsTable
        :site-id="siteId"
        :tracking="site.tracksInventory"
      />
      <EditSiteDialog
        :site="editing ? site : null"
        @close="editing = false"
      />
      <AddSiteItemDialog
        v-model="adding"
        :site-id="siteId"
        :site-name="site.name"
        :tracking="site.tracksInventory"
      />
    </template>
  </div>
</template>

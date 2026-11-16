<script setup lang="ts">
import { mdiDeleteOutline, mdiMagnify } from '@mdi/js'

// What a site holds, by product name, a page at a time. Each step of an
// on-hand count queues a change; the steps of one item fold into one.
const props = defineProps<{ siteId: string }>()

const PAGE = 50
const search = ref('')
const first = ref(PAGE)
watch(search, () => (first.value = PAGE))
const { data, loading, fetching } = useSiteItems(() => ({ siteId: props.siteId, search: search.value.trim() || null, first: first.value }))
const items = computed(() => data.value?.siteItems.edges.map(e => e.node) ?? [])
const total = computed(() => data.value?.siteItems.totalCount ?? 0)
const pending = usePendingRows('SiteItem')
const { setOnHand, removeItem } = useInventory()
</script>

<template>
  <v-card variant="outlined">
    <v-card-item>
      <v-text-field
        v-model="search"
        :prepend-inner-icon="mdiMagnify"
        label="Search by product or SKU"
        density="compact"
        hide-details
        clearable
      />
    </v-card-item>
    <v-progress-linear
      :active="fetching"
      indeterminate
      height="2"
    />
    <v-table density="comfortable">
      <thead>
        <tr>
          <th>Product</th>
          <th class="d-none d-md-table-cell">
            SKU
          </th>
          <th class="text-end">
            On hand
          </th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading && !items.length">
          <td colspan="4">
            <v-skeleton-loader type="table-row@5" />
          </td>
        </tr>
        <tr
          v-for="item in items"
          :key="item.id"
        >
          <td>
            <div>{{ item.productName }}</div>
            <div class="text-body-small text-medium-emphasis d-flex align-center ga-2">
              {{ item.variantName }}
              <PendingChip v-if="pending.has(item.id)" />
            </div>
          </td>
          <td class="d-none d-md-table-cell text-medium-emphasis">
            {{ item.sku }}
          </td>
          <td
            class="text-end"
            style="width: 160px"
          >
            <v-number-input
              :model-value="item.onHand"
              :min="0"
              density="compact"
              control-variant="split"
              hide-details
              @update:model-value="setOnHand.mutate({ siteId: item.siteId, variantId: item.variantId, onHand: $event })"
            />
          </td>
          <td class="text-end">
            <v-btn
              :icon="mdiDeleteOutline"
              variant="text"
              size="small"
              aria-label="Remove from the site"
              @click="removeItem.mutate({ siteId: item.siteId, variantId: item.variantId })"
            />
          </td>
        </tr>
      </tbody>
    </v-table>
    <v-card-actions v-if="items.length < total">
      <span class="text-body-small text-medium-emphasis ms-2">{{ items.length }} of {{ total.toLocaleString() }}</span>
      <v-spacer />
      <v-btn
        :loading="fetching"
        @click="first += PAGE"
      >
        Load more
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

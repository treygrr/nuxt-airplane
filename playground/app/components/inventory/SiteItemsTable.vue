<script setup lang="ts">
import { mdiCartPlus, mdiDeleteOutline, mdiMagnify, mdiTuneVariant } from '@mdi/js'
import { encodeCursor } from '~/lib/airplane'
import { LEVEL_STATUS, levelStatus, suggestedRestock } from '~/lib/restock'

// What a site holds, a page at a time, in Vuetify's server-side data table:
// each page is a query with an offset, answered from the tables offline.
// Each step of an on-hand count queues a change; the steps of one item fold
// into one. Where the site tracks inventory, each item shows its levels and
// can go into the site's restock cart.
const props = defineProps<{ siteId: string, tracking: boolean }>()

const search = ref('')
const page = ref(1)
const itemsPerPage = ref(25)
watch(search, () => (page.value = 1))

const { data, loading, fetching } = useSiteItems(() => ({
  siteId: props.siteId,
  search: search.value.trim() || null,
  first: itemsPerPage.value,
  after: page.value > 1 ? encodeCursor((page.value - 1) * itemsPerPage.value) : null,
}))
const items = computed(() => data.value?.siteItems.edges.map(e => e.node) ?? [])
const total = computed(() => data.value?.siteItems.totalCount ?? 0)
const pending = usePendingRows('SiteItem')
const { byItem: inCart } = useSiteCartLines(() => props.siteId)
const { setOnHand, removeItem, addToCart } = useInventory()

type Item = (typeof items.value)[number]
const editing = ref<Item | null>(null)

const headers = computed(() => [
  { title: 'Product', key: 'product', sortable: false },
  { title: 'SKU', key: 'sku', sortable: false },
  { title: 'On hand', key: 'onHand', sortable: false, align: 'end' as const, width: 170 },
  ...(props.tracking
    ? [
        { title: 'Min', key: 'min', sortable: false, align: 'end' as const },
        { title: 'Max', key: 'max', sortable: false, align: 'end' as const },
        { title: 'Status', key: 'status', sortable: false },
        { title: 'In cart', key: 'inCart', sortable: false, align: 'end' as const },
      ]
    : []),
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
])

function restock(item: Item) {
  const quantity = suggestedRestock(item, inCart.value.get(item.id)?.quantity ?? 0)
  addToCart.mutate({ siteId: item.siteId, variantId: item.variantId, quantity })
}
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
    <v-data-table-server
      v-model:page="page"
      v-model:items-per-page="itemsPerPage"
      :headers="headers"
      :items="items"
      :items-length="total"
      :loading="loading || fetching"
      :items-per-page-options="[10, 25, 50, 100]"
      item-value="id"
      density="comfortable"
      no-data-text="Nothing here yet"
    >
      <template #[`item.product`]="{ item }">
        <div>{{ item.productName }}</div>
        <div class="text-body-small text-medium-emphasis d-flex align-center flex-wrap ga-1">
          {{ item.variantName }}
          <OrderRuleChips
            v-if="tracking"
            :box-quantity="item.boxQuantity"
            :min-order-quantity="item.minOrderQuantity"
          />
          <PendingChip v-if="pending.has(item.id)" />
        </div>
      </template>
      <template #[`item.sku`]="{ item }">
        <span class="text-medium-emphasis">{{ item.sku }}</span>
      </template>
      <template #[`item.onHand`]="{ item }">
        <v-number-input
          :model-value="item.onHand"
          :min="0"
          density="compact"
          control-variant="split"
          hide-details
          @update:model-value="setOnHand.mutate({ siteId: item.siteId, variantId: item.variantId, onHand: $event })"
        />
      </template>
      <template #[`item.status`]="{ item }">
        <v-chip
          :color="LEVEL_STATUS[levelStatus(item)].color"
          size="small"
          variant="tonal"
        >
          {{ LEVEL_STATUS[levelStatus(item)].title }}
        </v-chip>
      </template>
      <template #[`item.inCart`]="{ item }">
        {{ inCart.get(item.id)?.quantity ?? '' }}
      </template>
      <template #[`item.actions`]="{ item }">
        <div class="d-flex justify-end">
          <template v-if="tracking">
            <v-btn
              v-tooltip="`Add ${suggestedRestock(item, inCart.get(item.id)?.quantity ?? 0)} to the restock cart`"
              :icon="mdiCartPlus"
              variant="text"
              size="small"
              :color="levelStatus(item) === 'low' ? 'primary' : undefined"
              :aria-label="`Add ${item.productName} to the restock cart`"
              @click="restock(item)"
            />
            <v-btn
              v-tooltip="'Inventory levels'"
              :icon="mdiTuneVariant"
              variant="text"
              size="small"
              aria-label="Inventory levels"
              @click="editing = item"
            />
          </template>
          <v-btn
            :icon="mdiDeleteOutline"
            variant="text"
            size="small"
            aria-label="Remove from the site"
            @click="removeItem.mutate({ siteId: item.siteId, variantId: item.variantId })"
          />
        </div>
      </template>
    </v-data-table-server>
    <SiteItemLevelsDialog
      :item="editing"
      @close="editing = null"
    />
  </v-card>
</template>

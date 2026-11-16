<script setup lang="ts">
import { mdiCartPlus, mdiCounter, mdiDeleteOutline, mdiDotsVertical, mdiMagnify, mdiSortAscending, mdiSortDescending, mdiTuneVariant } from '@mdi/js'
import type { SiteItemSort } from '#shared/siteItemSort'
import { encodeCursor } from '~/lib/airplane'
import { LEVEL_STATUS, fitRestock, levelStatus, suggestedRestock } from '~/lib/restock'

// What a site holds, a page at a time, in Vuetify's server-side data table:
// each page is a query with an offset, answered from the tables offline.
// Each row has a restock quantity and adds it to the site's cart: where the
// site tracks inventory, what it takes to fill the item to its max; where it
// does not, the least that may be ordered. The rest of what can be done to an
// item is in its menu.
// Each row leads with the product's picture, ringed in its level's colour
// where the site tracks levels. The order is picked from a menu of columns.
const props = defineProps<{ siteId: string, tracking: boolean }>()

const search = ref('')
const page = ref(1)
const itemsPerPage = ref(25)

// Sorting is a menu of the columns, not header clicks. Levels only mean
// something where the site tracks them.
const sortOptions = computed(() => [
  { title: 'Product', value: 'NAME' as const },
  { title: 'SKU', value: 'SKU' as const },
  { title: 'On hand', value: 'ON_HAND' as const },
  ...(props.tracking
    ? [
        { title: 'Min', value: 'MIN' as const },
        { title: 'Max', value: 'MAX' as const },
        { title: 'Stock level', value: 'LEVEL' as const },
      ]
    : []),
])
const sort = ref<SiteItemSort>('NAME')
const descending = ref(false)
watch(sortOptions, (options) => {
  if (!options.some(o => o.value === sort.value)) sort.value = 'NAME'
})
watch([search, sort, descending], () => (page.value = 1))

const { data, loading, fetching } = useSiteItems(() => ({
  siteId: props.siteId,
  search: search.value?.trim() || null,
  sort: sort.value,
  descending: descending.value,
  first: itemsPerPage.value,
  after: page.value > 1 ? encodeCursor((page.value - 1) * itemsPerPage.value) : null,
}))
const items = computed(() => data.value?.siteItems.edges.map(e => e.node) ?? [])
const total = computed(() => data.value?.siteItems.totalCount ?? 0)
const pending = usePendingRows('SiteItem')
const { byItem: cart } = useSiteCartLines(() => props.siteId)
const { removeItem, addToCart } = useInventory()

type Item = (typeof items.value)[number]
const adjusting = ref<Item | null>(null)
const editingLevels = ref<Item | null>(null)

const inCart = (item: Item) => cart.value.get(item.id)?.quantity ?? 0
/**
 * What to offer: what fills the item to its max, in what may be ordered, or 0
 * when it is full. Without levels, the least that may be ordered.
 */
function needed(item: Item) {
  if (!props.tracking) return fitRestock(item, 1)
  return item.max - item.onHand - inCart(item) > 0 ? suggestedRestock(item, inCart(item)) : 0
}

// A quantity typed into a row stays until it is added; until then the row
// shows what it needs, which follows the counts and the cart.
const typed = reactive(new Map<string, number>())
const amount = (item: Item) => typed.get(item.id) ?? needed(item)

function restock(item: Item) {
  const quantity = amount(item)
  if (!quantity) return
  addToCart.mutate({ siteId: item.siteId, variantId: item.variantId, quantity })
  typed.delete(item.id)
}

const headers = computed(() => [
  { title: 'Product', key: 'product', sortable: false },
  { title: 'SKU', key: 'sku', sortable: false },
  { title: 'On hand', key: 'onHand', sortable: false, align: 'end' as const },
  ...(props.tracking
    ? [
        { title: 'Min', key: 'min', sortable: false, align: 'end' as const },
        { title: 'Max', key: 'max', sortable: false, align: 'end' as const },
      ]
    : []),
  { title: 'Restock', key: 'restock', sortable: false, width: 230 },
  { title: '', key: 'actions', sortable: false, align: 'end' as const, width: 56 },
])
</script>

<template>
  <v-card
    border
    flat
  >
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
      no-data-text="Nothing here matches"
      hover
    >
      <template #top>
        <div class="d-flex align-center flex-wrap ga-3 px-4 py-3">
          <div class="me-auto">
            <span class="text-title-medium">Items</span>
            <span class="text-body-medium text-medium-emphasis ms-2">{{ total.toLocaleString() }}</span>
          </div>
          <v-text-field
            v-model="search"
            :prepend-inner-icon="mdiMagnify"
            placeholder="Search products or SKUs"
            variant="solo-filled"
            density="compact"
            max-width="340"
            min-width="220"
            flat
            rounded
            hide-details
            clearable
          />
          <div class="d-flex align-center ga-1">
            <v-select
              v-model="sort"
              :items="sortOptions"
              label="Sort by"
              density="compact"
              variant="outlined"
              min-width="170"
              hide-details
            />
            <v-btn
              v-tooltip="descending ? 'Descending' : 'Ascending'"
              :icon="descending ? mdiSortDescending : mdiSortAscending"
              :aria-label="descending ? 'Sorted descending' : 'Sorted ascending'"
              variant="text"
              size="small"
              @click="descending = !descending"
            />
          </div>
        </div>
        <v-divider />
      </template>

      <template #[`item.product`]="{ item }">
        <div class="d-flex align-center ga-3 py-2">
          <v-img
            :src="item.imageUrl"
            :alt="item.productName"
            :class="tracking && `level-${levelStatus(item)}`"
            :title="tracking ? LEVEL_STATUS[levelStatus(item)].title : undefined"
            width="56"
            :aspect-ratio="1"
            rounded="lg"
            class="flex-grow-0 preview"
            cover
          />
          <div>
            <div>{{ item.productName }}</div>
            <div class="text-body-small text-medium-emphasis d-flex align-center flex-wrap ga-1">
              {{ item.variantName }}
              <OrderRuleChips
                :box-quantity="item.boxQuantity"
                :min-order-quantity="item.minOrderQuantity"
              />
              <PendingChip v-if="pending.has(item.id)" />
            </div>
          </div>
        </div>
      </template>
      <template #[`item.sku`]="{ item }">
        <span class="text-medium-emphasis">{{ item.sku }}</span>
      </template>
      <template #[`item.onHand`]="{ item }">
        <span class="font-weight-medium">{{ item.onHand.toLocaleString() }}</span>
      </template>
      <template #[`item.restock`]="{ item }">
        <!--
          One control: the quantity, joined to the cart button that adds it,
          with what the cart holds of the item beside the icon. With nothing
          to add the button is read-only rather than disabled, so the count
          stays readable.
        -->
        <div class="restock-group d-flex">
          <RestockQuantityInput
            :model-value="amount(item)"
            :rules="item"
            optional
            :aria-label="`Restock quantity for ${item.productName}`"
            @update:model-value="typed.set(item.id, $event)"
          />
          <v-btn
            :readonly="!amount(item)"
            :aria-disabled="!amount(item)"
            :aria-label="`Add ${item.productName} to the restock cart`"
            :variant="amount(item) ? 'flat' : 'tonal'"
            color="primary"
            height="40"
            min-width="56"
            rounded="0"
            class="restock-group__cart px-3"
            @click="restock(item)"
          >
            <v-icon :icon="mdiCartPlus" />
            <span
              v-if="inCart(item)"
              class="ms-1"
              data-test="in-cart"
            >{{ inCart(item) }}</span>
          </v-btn>
        </div>
      </template>
      <template #[`item.actions`]="{ item }">
        <v-menu location="bottom end">
          <template #activator="{ props: menu }">
            <v-btn
              v-bind="menu"
              :icon="mdiDotsVertical"
              variant="text"
              size="small"
              :aria-label="`Actions for ${item.productName}`"
            />
          </template>
          <v-list density="compact">
            <v-list-item
              :prepend-icon="mdiCounter"
              title="Adjust on hand"
              @click="adjusting = item"
            />
            <v-list-item
              v-if="tracking"
              :prepend-icon="mdiTuneVariant"
              title="Inventory levels"
              @click="editingLevels = item"
            />
            <v-divider />
            <v-list-item
              :prepend-icon="mdiDeleteOutline"
              title="Remove from site"
              base-color="error"
              @click="removeItem.mutate({ siteId: item.siteId, variantId: item.variantId })"
            />
          </v-list>
        </v-menu>
      </template>
    </v-data-table-server>
    <AdjustOnHandDialog
      :item="adjusting"
      @close="adjusting = null"
    />
    <SiteItemLevelsDialog
      :item="editingLevels"
      @close="editingLevels = null"
    />
  </v-card>
</template>

<style scoped>
/* A tracked item's picture is ringed in the colour of its level. */
.preview.level-low,
.preview.level-ok,
.preview.level-over {
  border: 3px solid;
}
.preview.level-low { border-color: rgb(var(--v-theme-error)); }
.preview.level-ok { border-color: rgb(var(--v-theme-success)); }
.preview.level-over { border-color: rgb(var(--v-theme-warning)); }
</style>

<style scoped>
/* The field and the button read as one control: square where they meet. */
.restock-group {
  width: 220px;
}
.restock-group :deep(.v-field) {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}
.restock-group__cart {
  border-start-end-radius: 4px !important;
  border-end-end-radius: 4px !important;
}
</style>

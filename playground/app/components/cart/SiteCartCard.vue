<script setup lang="ts">
import { mdiDeleteOutline } from '@mdi/js'
import { rulesText } from '~/lib/restock'

// One site's restock cart: its lines in a data table, and checking it out,
// which adds each quantity to what the site holds. It can be checked out
// offline: the restock is queued, and the site's counts go up at once.
const props = defineProps<{
  site: { id: string, name: string }
  lines: { id: string, siteId: string, variantId: string, productName: string, variantName: string, sku: string, quantity: number, boxQuantity?: number | null, minOrderQuantity?: number | null }[]
}>()

const pending = usePendingRows('SiteCartLine')
const { setCartQuantity, removeFromCart, checkOut } = useInventory()
const units = computed(() => props.lines.reduce((sum, line) => sum + line.quantity, 0))

const headers = [
  { title: 'Product', key: 'product', sortable: false },
  { title: 'SKU', key: 'sku', sortable: false },
  { title: 'Quantity', key: 'quantity', sortable: false, align: 'end' as const, width: 190 },
  { title: '', key: 'actions', sortable: false, align: 'end' as const, width: 56 },
]
</script>

<template>
  <v-card
    border
    flat
  >
    <v-card-item>
      <v-card-title>
        <NuxtLink
          :to="`/inventory/${site.id}`"
          class="text-decoration-none"
          style="color: inherit"
        >
          {{ site.name }}
        </NuxtLink>
      </v-card-title>
      <v-card-subtitle>
        {{ lines.length }} item{{ lines.length === 1 ? '' : 's' }} · {{ units.toLocaleString() }} units
      </v-card-subtitle>
    </v-card-item>
    <v-data-table
      :headers="headers"
      :items="lines"
      :items-per-page="-1"
      item-value="id"
      density="comfortable"
      hide-default-footer
    >
      <template #[`item.product`]="{ item }">
        <div>{{ item.productName }}</div>
        <div class="text-body-small text-medium-emphasis d-flex align-center flex-wrap ga-2">
          {{ item.variantName }}
          <PendingChip v-if="pending.has(item.id)" />
        </div>
      </template>
      <template #[`item.sku`]="{ item }">
        <span class="text-medium-emphasis">{{ item.sku }}</span>
      </template>
      <template #[`item.quantity`]="{ item }">
        <RestockQuantityInput
          :model-value="item.quantity"
          :rules="item"
          @update:model-value="setCartQuantity.mutate({ siteId: item.siteId, variantId: item.variantId, quantity: $event })"
        />
        <div
          v-if="rulesText(item)"
          class="text-body-small text-medium-emphasis mt-1"
        >
          {{ rulesText(item) }}
        </div>
      </template>
      <template #[`item.actions`]="{ item }">
        <v-btn
          :icon="mdiDeleteOutline"
          variant="text"
          size="small"
          :aria-label="`Take ${item.productName} out of the cart`"
          @click="removeFromCart.mutate({ siteId: item.siteId, variantId: item.variantId })"
        />
      </template>
    </v-data-table>
    <v-card-actions class="px-4 pb-4">
      <span class="text-body-small text-medium-emphasis">Checking out adds these to what {{ site.name }} holds.</span>
      <v-spacer />
      <v-btn
        color="primary"
        variant="flat"
        @click="checkOut.mutate({ siteId: site.id })"
      >
        Check out · restock {{ units.toLocaleString() }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

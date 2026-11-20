<script setup lang="ts">
// Adding a product to a site, in two steps: which product and variant, then
// how many the site holds and, where it tracks inventory, the levels to keep
// it between. The product search reads the catalog from the tables, so with
// the catalog kept offline it works offline too.
import { suggestedRestock } from '~/lib/restock'

const props = defineProps<{ siteId: string, siteName: string, tracking: boolean }>()
const open = defineModel<boolean>({ default: false })

const step = ref(1)
const search = ref('')
const productId = ref<string | null>(null)
const variantId = ref<string | null>(null)
const onHand = ref(0)
const min = ref(0)
const max = ref(0)

watch(open, (isOpen) => {
  if (!isOpen) return
  step.value = 1
  search.value = ''
  productId.value = null
  onHand.value = 0
  min.value = 0
  max.value = 0
})

const { data, fetching } = useAirplaneQuery('GetProducts', () => ({ first: 20, search: search.value.trim() || null }))
const products = computed(() => data.value?.products.edges.map(e => e.node) ?? [])
// The chosen product stays known while the search moves on.
const chosen = ref<(typeof products.value)[number] | null>(null)
watch(productId, (id) => {
  chosen.value = products.value.find(p => p.id === id) ?? null
  variantId.value = chosen.value?.variants[0]?.id ?? null
})
const variant = computed(() => chosen.value?.variants.find(v => v.id === variantId.value))

const levelsValid = computed(() => !props.tracking || min.value <= max.value)
const firstRestock = computed(() => variant.value && props.tracking && onHand.value < min.value
  ? suggestedRestock({ onHand: onHand.value, min: min.value, max: max.value, ...variant.value })
  : 0)

const { addItem, addToCart } = useInventory()
const restockNow = ref(true)

function add() {
  if (!variant.value || !levelsValid.value) return
  const ids = { siteId: props.siteId, variantId: variant.value.id }
  addItem.mutate({ ...ids, onHand: onHand.value, ...(props.tracking ? { min: min.value, max: max.value } : {}) })
  if (firstRestock.value && restockNow.value) addToCart.mutate({ ...ids, quantity: firstRestock.value })
  open.value = false
}
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="640"
  >
    <v-card :title="`Add a product to ${siteName}`">
      <v-stepper
        v-model="step"
        :items="['Product', tracking ? 'Inventory levels' : 'Current inventory']"
        flat
        hide-actions
      >
        <template #[`item.1`]>
          <v-autocomplete
            v-model="productId"
            v-model:search="search"
            :items="products"
            :loading="fetching"
            item-title="name"
            item-value="id"
            label="Search products"
            no-filter
            autofocus
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item
                v-bind="itemProps"
                :subtitle="`${item.brand} · ${item.variants.length} option${item.variants.length === 1 ? '' : 's'}`"
              />
            </template>
          </v-autocomplete>
          <v-select
            v-model="variantId"
            :items="chosen?.variants ?? []"
            item-title="name"
            item-value="id"
            label="Variant"
            :disabled="!chosen"
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item
                v-bind="itemProps"
                :subtitle="item.sku"
              />
            </template>
          </v-select>
          <div
            v-if="variant"
            class="d-flex align-center flex-wrap ga-2 text-body-small text-medium-emphasis"
          >
            SKU {{ variant.sku }}
            <OrderRuleChips v-bind="variant" />
          </div>
        </template>

        <template #[`item.2`]>
          <div
            v-if="chosen && variant"
            class="mb-4"
          >
            <div class="text-title-small">
              {{ chosen.name }}
            </div>
            <div class="text-body-small text-medium-emphasis d-flex align-center flex-wrap ga-2">
              {{ variant.name }} · {{ variant.sku }}
              <OrderRuleChips v-bind="variant" />
            </div>
          </div>
          <LevelFields
            v-model:on-hand="onHand"
            v-model:min="min"
            v-model:max="max"
            :tracking="tracking"
          />
          <v-checkbox
            v-if="firstRestock"
            v-model="restockNow"
            :label="`Below min: add ${firstRestock} to the restock cart`"
            density="compact"
            hide-details
            class="mt-2"
          />
        </template>
      </v-stepper>
      <v-card-actions>
        <v-btn
          v-if="step > 1"
          @click="step--"
        >
          Back
        </v-btn>
        <v-spacer />
        <v-btn @click="open = false">
          Cancel
        </v-btn>
        <v-btn
          v-if="step === 1"
          color="primary"
          :disabled="!variant"
          @click="step = 2"
        >
          Next
        </v-btn>
        <v-btn
          v-else
          color="primary"
          :disabled="!levelsValid"
          @click="add"
        >
          Add to site
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

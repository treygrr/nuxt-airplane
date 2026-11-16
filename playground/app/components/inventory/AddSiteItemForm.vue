<script setup lang="ts">
// Stocks a product variant at a site. The product search reads the catalog
// from the tables, so with the catalog kept offline it works offline too.
const props = defineProps<{ siteId: string }>()

const search = ref('')
const productId = ref<string | null>(null)
const variantId = ref<string | null>(null)
const onHand = ref(0)

const { data } = useQuery('GetProducts', () => ({ first: 20, search: search.value.trim() || null }))
const products = computed(() => data.value?.products.edges.map(e => e.node) ?? [])
const product = computed(() => products.value.find(p => p.id === productId.value))
watch(product, p => (variantId.value = p?.variants[0]?.id ?? null))

const { addItem } = useInventory()
function add() {
  if (!variantId.value) return
  addItem.mutate({ siteId: props.siteId, variantId: variantId.value, onHand: onHand.value })
  productId.value = null
  onHand.value = 0
}
</script>

<template>
  <v-card
    variant="outlined"
    title="Stock a product here"
  >
    <v-card-text>
      <v-row dense>
        <v-col
          cols="12"
          md="6"
        >
          <v-autocomplete
            v-model="productId"
            v-model:search="search"
            :items="products"
            item-title="name"
            item-value="id"
            label="Product"
            density="compact"
            no-filter
            hide-details
          />
        </v-col>
        <v-col
          cols="7"
          md="3"
        >
          <v-select
            v-model="variantId"
            :items="product?.variants ?? []"
            item-title="name"
            item-value="id"
            label="Variant"
            density="compact"
            :disabled="!product"
            hide-details
          />
        </v-col>
        <v-col
          cols="5"
          md="3"
        >
          <v-number-input
            v-model="onHand"
            label="On hand"
            :min="0"
            density="compact"
            control-variant="stacked"
            hide-details
          />
        </v-col>
      </v-row>
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn
        color="primary"
        :disabled="!variantId"
        @click="add"
      >
        Add to site
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

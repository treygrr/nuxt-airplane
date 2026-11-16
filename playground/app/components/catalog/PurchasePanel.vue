<script setup lang="ts">
import { mdiCloudOffOutline, mdiKeyboardReturn, mdiTruckFastOutline } from '@mdi/js'

// The buying side of a product page: price, stock, the options, the cart,
// and what comes with every order.
const props = defineProps<{
  product: NuxtAirplaneStores['Product']
}>()
const variantId = defineModel<string | null>('variantId', { default: null })
const variant = computed(() => props.product.variants.find(v => v.id === variantId.value))

const perks = [
  { icon: mdiTruckFastOutline, text: 'Free shipping on orders over $100' },
  { icon: mdiKeyboardReturn, text: '30-day returns' },
  { icon: mdiCloudOffOutline, text: 'Add to your cart offline: it syncs when you are back' },
]
</script>

<template>
  <v-card
    border
    flat
    class="pa-6"
  >
    <div class="text-label-large text-uppercase text-medium-emphasis">
      {{ product.brand }}
    </div>
    <h1 class="text-headline-small font-weight-bold mb-2">
      {{ product.name }}
    </h1>
    <RatingStars
      :rating="product.rating"
      :count="product.reviewCount"
      class="mb-4"
    />
    <template v-if="variant">
      <div class="d-flex align-center flex-wrap ga-3 mb-1">
        <span class="text-headline-medium font-weight-bold">{{ formatMoney(variant.price) }}</span>
        <StockBadge :stock="variant.stock" />
      </div>
      <div class="text-body-small text-medium-emphasis mb-4">
        SKU {{ variant.sku }}
      </div>
    </template>
    <template v-if="product.variants.length > 1">
      <div class="text-title-small mb-1">
        Options
      </div>
      <VariantPicker
        v-model="variantId"
        :variants="product.variants"
        class="mb-4"
      />
    </template>
    <AddToCart
      v-if="variant"
      :variant="variant"
      class="mb-3"
    />
    <SaveToList
      :product-id="product.id"
      :variant-id="variantId"
      class="mb-6"
    />
    <v-divider class="mb-4" />
    <div
      v-for="perk in perks"
      :key="perk.text"
      class="d-flex align-center ga-3 text-body-medium mb-2"
    >
      <v-icon
        :icon="perk.icon"
        color="primary"
        size="20"
      />
      {{ perk.text }}
    </div>
  </v-card>
</template>

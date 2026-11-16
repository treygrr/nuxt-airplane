<script setup lang="ts">
import { mdiCartPlus } from '@mdi/js'

// A product in a grid: picture, brand, name, rating, price, stock, and a
// button that puts its first variant in stock in the cart.
const props = defineProps<{
  product: { id: string, name: string, brand: string, price: number, rating: number, reviewCount: number, imageUrl: string, variants: { id: string, stock: number }[] }
}>()
defineEmits<{ add: [variantId: string] }>()

const stock = computed(() => props.product.variants.reduce((n, v) => n + v.stock, 0))
const firstInStock = computed(() => props.product.variants.find(v => v.stock > 0))
</script>

<template>
  <v-card
    :to="`/p/${product.id}`"
    border
    flat
    hover
    class="lift d-flex flex-column h-100"
  >
    <v-img
      :src="product.imageUrl"
      :alt="product.name"
      :aspect-ratio="4 / 3"
      class="flex-grow-0 flex-shrink-0"
      cover
    />
    <div class="pa-4 d-flex flex-column flex-grow-1">
      <div class="text-label-small text-uppercase text-medium-emphasis mb-1">
        {{ product.brand }}
      </div>
      <div
        class="text-body-medium font-weight-medium line-clamp-2 mb-2"
        :title="product.name"
      >
        {{ product.name }}
      </div>
      <RatingStars
        :rating="product.rating"
        :count="product.reviewCount"
        class="mb-3"
      />
      <v-spacer />
      <div class="d-flex align-center ga-2">
        <div class="me-auto">
          <span
            v-if="product.variants.length > 1"
            class="text-body-small text-medium-emphasis"
          >From </span>
          <span class="text-title-large font-weight-bold">{{ formatMoney(product.price) }}</span>
        </div>
        <v-btn
          v-if="firstInStock"
          :icon="mdiCartPlus"
          color="primary"
          variant="tonal"
          size="small"
          aria-label="Add to cart"
          @click.prevent="$emit('add', firstInStock.id)"
        />
      </div>
      <StockBadge
        :stock="stock"
        class="mt-2 align-self-start"
      />
    </div>
  </v-card>
</template>

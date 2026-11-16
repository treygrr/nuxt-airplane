<script setup lang="ts">
// A product in a grid: picture, name, price, rating, and whether it can be bought.
const props = defineProps<{
  product: { id: string, name: string, brand: string, price: number, rating: number, reviewCount: number, imageUrl: string, variants: { stock: number }[] }
}>()
const stock = computed(() => props.product.variants.reduce((n, v) => n + v.stock, 0))
</script>

<template>
  <v-card
    :to="`/p/${product.id}`"
    variant="outlined"
    height="100%"
    class="d-flex flex-column"
  >
    <v-img
      :src="product.imageUrl"
      :alt="product.name"
      aspect-ratio="4/3"
      cover
    />
    <v-card-item class="flex-grow-1">
      <div class="text-label-medium text-medium-emphasis">
        {{ product.brand }}
      </div>
      <div class="text-title-small">
        {{ product.name }}
      </div>
      <RatingStars
        :rating="product.rating"
        :count="product.reviewCount"
        class="mt-1"
      />
    </v-card-item>
    <v-card-text class="d-flex align-center pt-0">
      <span class="text-title-medium me-auto">
        <span
          v-if="product.variants.length > 1"
          class="text-body-small text-medium-emphasis"
        >from </span>{{ formatMoney(product.price) }}
      </span>
      <StockBadge :stock="stock" />
    </v-card-text>
  </v-card>
</template>

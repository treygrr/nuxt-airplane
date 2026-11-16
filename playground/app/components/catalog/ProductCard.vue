<script setup lang="ts">
// A product in a grid: picture, brand and stock, name, rating, price, and at
// the bottom a quantity joined to the cart button, which puts that many of
// its first variant in stock in the cart. The card opens the product; the
// quantity and button do not.
const props = defineProps<{
  product: { id: string, name: string, brand: string, price: number, rating: number, reviewCount: number, imageUrl: string, variants: { id: string, stock: number }[] }
  inCart?: number
}>()
defineEmits<{ add: [variantId: string, quantity: number] }>()

const stock = computed(() => props.product.variants.reduce((n, v) => n + v.stock, 0))
const firstInStock = computed(() => props.product.variants.find(v => v.stock > 0))
const quantity = ref(1)
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
      <div class="d-flex align-start ga-2 mb-1">
        <div class="text-label-small text-uppercase text-medium-emphasis me-auto">
          {{ product.brand }}
        </div>
        <StockBadge :stock="stock" />
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
      <div class="mb-3">
        <span
          v-if="product.variants.length > 1"
          class="text-body-small text-medium-emphasis"
        >From </span>
        <span class="text-title-large font-weight-bold">{{ formatMoney(product.price) }}</span>
      </div>
      <!--
        The card around it is a link. Its clicks must not follow it: they are
        cancelled on the way down, since the number field's buttons stop them
        before they could be cancelled on the way up.
      -->
      <div @click.capture.prevent>
        <CartQuantityGroup
          :can-add="!!firstInStock"
          :in-cart="inCart"
          :label="`Add ${product.name} to the cart`"
          @add="firstInStock && $emit('add', firstInStock.id, quantity)"
        >
          <v-number-input
            v-model="quantity"
            :min="1"
            :max="firstInStock?.stock ?? 1"
            :disabled="!firstInStock"
            :aria-label="`Quantity of ${product.name}`"
            density="compact"
            control-variant="split"
            hide-details
          />
        </CartQuantityGroup>
      </div>
    </div>
  </v-card>
</template>

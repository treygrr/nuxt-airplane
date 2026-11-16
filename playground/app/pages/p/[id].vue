<script setup lang="ts">
// A product: pictures, variants with their price and stock, the cart, and
// reviews. Every page visited leaves a fetch record behind for eviction.
const route = useRoute()
const id = computed(() => String(route.params.id))
const { product, loading } = useProduct(id)
const { byId } = useCategories()
const category = computed(() => (product.value ? byId(product.value.categoryId) : undefined))
useHead({ title: () => `${product.value?.name ?? 'Product'} · Toolshed` })

const variantId = ref<string | null>(null)
watch(product, p => (variantId.value = p?.variants.find(v => v.id === variantId.value)?.id ?? p?.variants[0]?.id ?? null), { immediate: true })
const variant = computed(() => product.value?.variants.find(v => v.id === variantId.value))
</script>

<template>
  <div>
    <v-skeleton-loader
      v-if="loading && !product"
      type="image, article"
    />
    <v-empty-state
      v-else-if="!product"
      title="Not available offline"
      text="This product has not been loaded on this device, or it is no longer sold."
    />
    <template v-else>
      <v-breadcrumbs
        :items="[{ title: 'Home', to: '/' }, ...(category ? [{ title: category.name, to: `/c/${category.id}` }] : []), { title: product.name, disabled: true }]"
        class="px-0"
      />
      <v-row>
        <v-col
          cols="12"
          md="6"
        >
          <v-img
            :src="product.imageUrl"
            :alt="product.name"
            aspect-ratio="4/3"
            rounded="lg"
            cover
          />
        </v-col>
        <v-col
          cols="12"
          md="6"
        >
          <div class="text-label-large text-medium-emphasis">
            {{ product.brand }}
          </div>
          <h1 class="text-headline-small mb-1">
            {{ product.name }}
          </h1>
          <RatingStars
            :rating="product.rating"
            :count="product.reviewCount"
            class="mb-3"
          />
          <div
            v-if="variant"
            class="d-flex align-center ga-3 mb-3"
          >
            <span class="text-headline-small">{{ formatMoney(variant.price) }}</span>
            <StockBadge :stock="variant.stock" />
            <span class="text-body-small text-medium-emphasis">SKU {{ variant.sku }}</span>
          </div>
          <VariantPicker
            v-if="product.variants.length > 1"
            v-model="variantId"
            :variants="product.variants"
            class="mb-3"
          />
          <AddToCart
            v-if="variant"
            :variant="variant"
            class="mb-4"
          />
          <p class="text-body-medium">
            {{ product.description }}
          </p>
        </v-col>
      </v-row>
      <ProductReviews
        :product-id="product.id"
        class="mt-8"
      />
    </template>
  </div>
</template>

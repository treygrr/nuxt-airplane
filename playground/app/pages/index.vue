<script setup lang="ts">
// The shop's front page: the categories, the best rated products and the
// newest. The newest is the whole catalog, unfiltered: with "keep the
// catalog offline" on, fetching it starts the background walk of every page.
useHead({ title: 'Toolshed' })
const { products, loading } = useFeaturedProducts()
const newest = useProducts({ sort: 'NEWEST', first: 8 })
</script>

<template>
  <div>
    <h1 class="text-headline-medium mb-1">
      Tools for every job
    </h1>
    <p class="text-body-large text-medium-emphasis mb-4">
      Browse, fill your cart and check out. It all works with the network off.
    </p>
    <CategoryNav class="mb-6" />
    <h2 class="text-title-large mb-3">
      Best rated
    </h2>
    <ProductGrid
      :products="products"
      :loading="loading"
      class="mb-8"
    />
    <h2 class="text-title-large mb-3">
      New arrivals
    </h2>
    <ProductGrid
      :products="newest.products.value"
      :loading="newest.loading.value"
    />
  </div>
</template>

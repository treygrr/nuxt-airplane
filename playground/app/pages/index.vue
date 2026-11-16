<script setup lang="ts">
// The shop's front page. "New arrivals" is the whole catalog, unfiltered:
// with "keep the catalog offline" on, fetching it starts the background walk
// of every page.
useHead({ title: 'Toolshed · Tools for every job' })
const featured = useFeaturedProducts()
const newest = useProducts({ sort: 'NEWEST', first: 8 })
</script>

<template>
  <div>
    <HeroBanner class="mb-8" />
    <ValueProps class="mb-12" />

    <SectionHeader
      title="Shop by category"
      subtitle="Eight departments, thousands of tools"
    />
    <CategoryTiles class="mb-12" />

    <SectionHeader
      title="Best rated"
      subtitle="What the trades keep coming back for"
      to="/search"
    />
    <ProductGrid
      :products="featured.products.value.slice(0, 8)"
      :loading="featured.loading.value"
      class="mb-12"
    />

    <PromoBanner class="mb-12" />

    <SectionHeader
      title="New arrivals"
      subtitle="Just landed on the shelves"
      to="/search"
    />
    <ProductGrid
      :products="newest.products.value"
      :loading="newest.loading.value"
    />
  </div>
</template>

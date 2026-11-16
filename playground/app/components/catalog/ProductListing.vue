<script setup lang="ts">
// A product listing with its own sort, stock filter and "load more". The
// category or search comes from the page. Changing any of them while offline
// still works: the listing is read from the tables.
const props = defineProps<{ categoryId?: string | null, search?: string | null }>()

const PAGE = 24
const sort = ref<ProductSort>('NAME')
const inStockOnly = ref(false)
const first = ref(PAGE)
watch(() => [props.categoryId, props.search, sort.value, inStockOnly.value], () => (first.value = PAGE))

const { products, total, loading, fetching, error } = useProducts(() => ({
  categoryId: props.categoryId,
  search: props.search,
  sort: sort.value,
  inStockOnly: inStockOnly.value,
  first: first.value,
}))

const SORTS: { title: string, value: ProductSort }[] = [
  { title: 'Name', value: 'NAME' },
  { title: 'Price, low to high', value: 'PRICE_ASC' },
  { title: 'Price, high to low', value: 'PRICE_DESC' },
  { title: 'Best rated', value: 'RATING' },
  { title: 'Newest', value: 'NEWEST' },
]
</script>

<template>
  <div>
    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <span class="text-body-medium text-medium-emphasis me-auto">
        {{ total.toLocaleString() }} product{{ total === 1 ? '' : 's' }}
      </span>
      <v-switch
        v-model="inStockOnly"
        label="In stock only"
        density="compact"
        hide-details
      />
      <v-select
        v-model="sort"
        :items="SORTS"
        label="Sort"
        density="compact"
        max-width="220"
        hide-details
      />
    </div>
    <v-alert
      v-if="error && !products.length"
      type="warning"
      variant="tonal"
      :text="error.message"
      class="mb-4"
    />
    <ProductGrid
      :products="products"
      :loading="loading"
      :fetching="fetching"
      :total="total"
      :empty-text="search ? `No product matches “${search}”.` : undefined"
      @more="first += PAGE"
    />
  </div>
</template>

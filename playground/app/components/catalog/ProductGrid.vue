<script setup lang="ts">
import { mdiPackageVariantRemove } from '@mdi/js'

// Products in a responsive grid, with skeletons while the first ones load,
// an empty state, and "load more" while there are more to show.
defineProps<{
  products: NuxtAirplaneStores['Product'][]
  loading?: boolean
  fetching?: boolean
  total?: number
  emptyText?: string
}>()
defineEmits<{ more: [] }>()
</script>

<template>
  <div>
    <v-row v-if="loading && !products.length">
      <v-col
        v-for="n in 8"
        :key="n"
        cols="6"
        sm="4"
        lg="3"
      >
        <v-skeleton-loader type="card" />
      </v-col>
    </v-row>
    <v-empty-state
      v-else-if="!products.length"
      :icon="mdiPackageVariantRemove"
      title="Nothing here"
      :text="emptyText ?? 'No product matches.'"
    />
    <v-row v-else>
      <v-col
        v-for="product in products"
        :key="product.id"
        cols="6"
        sm="4"
        lg="3"
      >
        <ProductCard :product="product" />
      </v-col>
    </v-row>
    <div
      v-if="total != null && products.length < total"
      class="d-flex align-center justify-center ga-3 mt-6"
    >
      <span class="text-body-small text-medium-emphasis">{{ products.length }} of {{ total.toLocaleString() }}</span>
      <v-btn
        :loading="fetching"
        variant="tonal"
        @click="$emit('more')"
      >
        Load more
      </v-btn>
    </div>
  </div>
</template>

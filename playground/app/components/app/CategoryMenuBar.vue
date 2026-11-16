<script setup lang="ts">
import { mdiChevronDown } from '@mdi/js'

// The top-level categories along the app bar, each opening its subcategories.
const { top, childrenOf } = useCategories()
</script>

<template>
  <nav class="d-flex align-center ga-1 overflow-x-auto">
    <v-menu
      v-for="category in top"
      :key="category.id"
      open-on-hover
      :open-delay="80"
    >
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          :to="`/c/${category.id}`"
          :append-icon="mdiChevronDown"
          variant="text"
          size="small"
          class="text-body-medium"
        >
          {{ category.name }}
        </v-btn>
      </template>
      <v-list
        density="compact"
        min-width="220"
      >
        <v-list-item
          :to="`/c/${category.id}`"
          :title="`All ${category.name.toLowerCase()}`"
          :subtitle="`${category.productCount} products`"
        />
        <v-divider class="my-1" />
        <v-list-item
          v-for="child in childrenOf(category.id)"
          :key="child.id"
          :to="`/c/${child.id}`"
          :title="child.name"
        />
      </v-list>
    </v-menu>
  </nav>
</template>

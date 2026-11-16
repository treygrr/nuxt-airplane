<script setup lang="ts">
import { categoryStyle } from '#shared/categoryStyle'

// The top-level categories as tiles, each in its own color.
const { top, loading } = useCategories()
</script>

<template>
  <v-row v-if="loading && !top.length">
    <v-col
      v-for="n in 8"
      :key="n"
      cols="6"
      sm="3"
    >
      <v-skeleton-loader type="image" />
    </v-col>
  </v-row>
  <v-row v-else>
    <v-col
      v-for="category in top"
      :key="category.id"
      cols="6"
      sm="3"
    >
      <v-card
        :to="`/c/${category.id}`"
        :style="{ background: categoryStyle(category.name).tint }"
        flat
        class="lift pa-5 h-100"
      >
        <v-icon
          :icon="categoryStyle(category.name).icon"
          :color="categoryStyle(category.name).color"
          size="40"
          class="mb-4"
        />
        <div
          class="text-title-medium font-weight-bold"
          :style="{ color: categoryStyle(category.name).color }"
        >
          {{ category.name }}
        </div>
        <div class="text-body-small text-medium-emphasis">
          {{ category.productCount.toLocaleString() }} products
        </div>
      </v-card>
    </v-col>
  </v-row>
</template>

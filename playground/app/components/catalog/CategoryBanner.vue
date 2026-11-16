<script setup lang="ts">
import { categoryStyle } from '#shared/categoryStyle'

// The head of a category page, in the category's colors: its name, how many
// products, and its subcategories.
const props = defineProps<{
  category: { id: string, name: string, parentId: string | null, productCount: number }
  parentName?: string
}>()
const { childrenOf } = useCategories()
const style = computed(() => categoryStyle(props.category.name, props.parentName))
const children = computed(() => childrenOf(props.category.id))
</script>

<template>
  <v-sheet
    rounded="xl"
    class="d-flex align-center ga-6 pa-6 pa-md-8"
    :style="{ background: style.tint }"
  >
    <v-avatar
      size="72"
      rounded="lg"
      color="white"
      class="d-none d-sm-flex"
    >
      <v-icon
        :icon="style.icon"
        :color="style.color"
        size="40"
      />
    </v-avatar>
    <div class="flex-grow-1">
      <h1
        class="text-headline-medium font-weight-bold"
        :style="{ color: style.color }"
      >
        {{ category.name }}
      </h1>
      <div class="text-body-medium text-medium-emphasis mb-2">
        {{ category.productCount.toLocaleString() }} products{{ parentName ? ` in ${parentName}` : '' }}
      </div>
      <div
        v-if="children.length"
        class="d-flex flex-wrap ga-2"
      >
        <v-chip
          v-for="child in children"
          :key="child.id"
          :to="`/c/${child.id}`"
          color="white"
          variant="flat"
          size="small"
        >
          {{ child.name }}
        </v-chip>
      </div>
    </div>
  </v-sheet>
</template>

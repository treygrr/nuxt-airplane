<script setup lang="ts">
// The categories as chips: the top level, or one category's children.
const props = defineProps<{ parentId?: string | null, activeId?: string | null }>()
const { top, childrenOf } = useCategories()
const shown = computed(() => (props.parentId ? childrenOf(props.parentId) : top.value))
</script>

<template>
  <v-chip-group
    :model-value="activeId"
    selected-class="text-primary"
    column
  >
    <v-chip
      v-for="category in shown"
      :key="category.id"
      :value="category.id"
      :to="`/c/${category.id}`"
      variant="outlined"
    >
      {{ category.name }}
      <span class="text-medium-emphasis ms-1">{{ category.productCount }}</span>
    </v-chip>
  </v-chip-group>
</template>

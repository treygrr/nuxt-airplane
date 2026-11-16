<script setup lang="ts">
// A category: its subcategories, and its products (the subcategories' included).
const route = useRoute()
const categoryId = computed(() => String(route.params.category))
const { byId } = useCategories()
const category = computed(() => byId(categoryId.value))
const parent = computed(() => (category.value?.parentId ? byId(category.value.parentId) : undefined))
useHead({ title: () => `${category.value?.name ?? 'Category'} · Toolshed` })
</script>

<template>
  <div>
    <v-breadcrumbs
      :items="[{ title: 'Home', to: '/' }, ...(parent ? [{ title: parent.name, to: `/c/${parent.id}` }] : []), { title: category?.name ?? '…', disabled: true }]"
      class="px-0"
    />
    <h1 class="text-headline-medium mb-2">
      {{ category?.name ?? 'Category' }}
    </h1>
    <CategoryNav
      v-if="category && !category.parentId"
      :parent-id="category.id"
      class="mb-4"
    />
    <ProductListing :category-id="categoryId" />
  </div>
</template>

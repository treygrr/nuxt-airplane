<script setup lang="ts">
// A category: its banner, then its products (the subcategories' included).
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
      class="px-0 pt-0"
    />
    <CategoryBanner
      v-if="category"
      :category="category"
      :parent-name="parent?.name"
      class="mb-6"
    />
    <ProductListing :category-id="categoryId" />
  </div>
</template>

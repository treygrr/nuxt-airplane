<script setup lang="ts">
// A product: its picture and description, the purchase panel, and reviews.
// Every page visited leaves a fetch record behind, for eviction to drop first.
const route = useRoute()
const id = computed(() => String(route.params.id))
const { product, loading } = useProduct(id)
const { byId } = useCategories()
const category = computed(() => (product.value ? byId(product.value.categoryId) : undefined))
useHead({ title: () => `${product.value?.name ?? 'Product'} · Toolshed` })

const variantId = ref<string | null>(null)
watch(product, p => (variantId.value = p?.variants.find(v => v.id === variantId.value)?.id ?? p?.variants.find(v => v.stock > 0)?.id ?? p?.variants[0]?.id ?? null), { immediate: true })
</script>

<template>
  <div>
    <v-skeleton-loader
      v-if="loading && !product"
      type="image, article"
    />
    <v-empty-state
      v-else-if="!product"
      title="Not available offline"
      text="This product has not been loaded on this device, or it is no longer sold."
    />
    <template v-else>
      <v-breadcrumbs
        :items="[{ title: 'Home', to: '/' }, ...(category ? [{ title: category.name, to: `/c/${category.id}` }] : []), { title: product.name, disabled: true }]"
        class="px-0 pt-0"
      />
      <v-row>
        <v-col
          cols="12"
          md="7"
        >
          <v-img
            :src="product.imageUrl"
            :alt="product.name"
            :aspect-ratio="4 / 3"
            rounded="xl"
            class="border mb-6"
            cover
          />
          <ProductAbout
            :description="product.description"
            class="d-none d-md-block"
          />
        </v-col>
        <v-col
          cols="12"
          md="5"
        >
          <PurchasePanel
            v-model:variant-id="variantId"
            :product="product"
            style="position: sticky; top: 140px"
          />
        </v-col>
        <!-- On a phone the description follows the purchase panel. -->
        <v-col
          cols="12"
          class="d-md-none"
        >
          <ProductAbout :description="product.description" />
        </v-col>
      </v-row>
      <v-divider class="my-10" />
      <ProductReviews :product-id="product.id" />
    </template>
  </div>
</template>

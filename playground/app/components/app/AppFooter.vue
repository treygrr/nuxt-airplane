<script setup lang="ts">
// The footer: where to go next, and what this shop is.
const { top } = useCategories()

const columns = [
  { title: 'Your account', links: [{ title: 'Cart', to: '/cart' }, { title: 'Orders', to: '/orders' }, { title: 'Wishlists', to: '/wishlists' }, { title: 'Account', to: '/account' }] },
  { title: 'Staff', links: [{ title: 'Inventory', to: '/inventory' }, { title: 'Lab', to: '/dev' }] },
]
</script>

<template>
  <v-footer
    color="surface"
    border="t"
    class="mt-12 d-block"
  >
    <v-container
      style="max-width: 1280px"
      class="py-10"
    >
      <v-row>
        <v-col
          cols="12"
          md="4"
        >
          <BrandLogo class="mb-3" />
          <p
            class="text-body-medium text-medium-emphasis"
            style="max-width: 320px"
          >
            Tools for every job, and a shop that keeps working when the network does not. Changes made offline sync as soon as you are back.
          </p>
        </v-col>
        <v-col
          cols="6"
          md="3"
        >
          <div class="text-title-small mb-3">
            Shop
          </div>
          <NuxtLink
            v-for="category in top"
            :key="category.id"
            :to="`/c/${category.id}`"
            class="d-block text-body-medium text-medium-emphasis text-decoration-none mb-2"
          >
            {{ category.name }}
          </NuxtLink>
        </v-col>
        <v-col
          v-for="column in columns"
          :key="column.title"
          cols="6"
          md="2"
          :class="{ 'offset-md-1': column === columns[0] }"
        >
          <div class="text-title-small mb-3">
            {{ column.title }}
          </div>
          <NuxtLink
            v-for="link in column.links"
            :key="link.to"
            :to="link.to"
            class="d-block text-body-medium text-medium-emphasis text-decoration-none mb-2"
          >
            {{ link.title }}
          </NuxtLink>
        </v-col>
      </v-row>
      <v-divider class="my-6" />
      <div class="d-flex flex-wrap justify-space-between ga-2 text-body-small text-medium-emphasis">
        <span>© 2026 Toolshed, the nuxt-airplane playground. Not a real store.</span>
        <span>Prices in USD. Free shipping on orders over $100.</span>
      </div>
    </v-container>
  </v-footer>
</template>

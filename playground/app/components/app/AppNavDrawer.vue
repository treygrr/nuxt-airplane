<script setup lang="ts">
import { mdiAccountOutline, mdiCartOutline, mdiFlaskOutline, mdiHeartOutline, mdiHomeOutline, mdiMagnify, mdiPackageVariantClosed, mdiWarehouse } from '@mdi/js'

// The menu on a phone: the shop, the categories, the shopper's things and
// the staff side. On a wide screen the app bar does all of this.
const open = defineModel<boolean>({ default: false })
const { top } = useCategories()

const shop = [
  { title: 'Home', icon: mdiHomeOutline, to: '/' },
  { title: 'Search', icon: mdiMagnify, to: '/search' },
]
const mine = [
  { title: 'Cart', icon: mdiCartOutline, to: '/cart' },
  { title: 'Wishlists', icon: mdiHeartOutline, to: '/wishlists' },
  { title: 'Orders', icon: mdiPackageVariantClosed, to: '/orders' },
  { title: 'Account', icon: mdiAccountOutline, to: '/account' },
]
const staff = [
  { title: 'Inventory', icon: mdiWarehouse, to: '/inventory' },
  { title: 'Lab', icon: mdiFlaskOutline, to: '/dev' },
]
</script>

<template>
  <v-navigation-drawer
    v-model="open"
    temporary
    width="300"
  >
    <div class="pa-4">
      <BrandLogo />
    </div>
    <v-list
      nav
      density="comfortable"
    >
      <v-list-item
        v-for="item in shop"
        :key="item.to"
        :to="item.to"
        :prepend-icon="item.icon"
        :title="item.title"
        :exact="item.to === '/'"
      />
      <v-list-subheader>Categories</v-list-subheader>
      <v-list-item
        v-for="category in top"
        :key="category.id"
        :to="`/c/${category.id}`"
        :title="category.name"
      />
      <v-list-subheader>Yours</v-list-subheader>
      <v-list-item
        v-for="item in mine"
        :key="item.to"
        :to="item.to"
        :prepend-icon="item.icon"
        :title="item.title"
      />
      <v-list-subheader>Staff</v-list-subheader>
      <v-list-item
        v-for="item in staff"
        :key="item.to"
        :to="item.to"
        :prepend-icon="item.icon"
        :title="item.title"
      />
    </v-list>
  </v-navigation-drawer>
</template>

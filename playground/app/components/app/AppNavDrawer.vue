<script setup lang="ts">
import { mdiAccountOutline, mdiCartOutline, mdiFlaskOutline, mdiHeartOutline, mdiHomeOutline, mdiMagnify, mdiPackageVariantClosed, mdiWarehouse } from '@mdi/js'

const open = defineModel<boolean | null>({ default: null })

const shop = [
  { title: 'Home', icon: mdiHomeOutline, to: '/' },
  { title: 'Search', icon: mdiMagnify, to: '/search' },
  { title: 'Cart', icon: mdiCartOutline, to: '/cart' },
  { title: 'Wishlists', icon: mdiHeartOutline, to: '/wishlists' },
  { title: 'Orders', icon: mdiPackageVariantClosed, to: '/orders' },
  { title: 'Account', icon: mdiAccountOutline, to: '/account' },
]
// Inventory management: the warehouses (sites) and what each holds. A
// separate area of the app from the shop, on the same server.
const inventory = [
  { title: 'Sites', icon: mdiWarehouse, to: '/inventory' },
]
const tools = [
  { title: 'Lab', icon: mdiFlaskOutline, to: '/dev' },
]
</script>

<template>
  <v-navigation-drawer v-model="open">
    <v-list nav>
      <v-list-subheader>Shop</v-list-subheader>
      <v-list-item
        v-for="item in shop"
        :key="item.to"
        :to="item.to"
        :prepend-icon="item.icon"
        :title="item.title"
        :exact="item.to === '/'"
      />
    </v-list>
    <v-divider />
    <v-list nav>
      <v-list-subheader>Inventory</v-list-subheader>
      <v-list-item
        v-for="item in inventory"
        :key="item.to"
        :to="item.to"
        :prepend-icon="item.icon"
        :title="item.title"
      />
    </v-list>
    <v-divider />
    <v-list
      nav
      density="compact"
    >
      <v-list-subheader>Testing</v-list-subheader>
      <v-list-item
        v-for="item in tools"
        :key="item.to"
        :to="item.to"
        :prepend-icon="item.icon"
        :title="item.title"
      />
    </v-list>
  </v-navigation-drawer>
</template>

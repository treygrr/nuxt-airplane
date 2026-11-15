<script setup lang="ts">
import { mdiAccountOutline, mdiCartOutline, mdiFlaskOutline, mdiHeartOutline, mdiHistory, mdiHomeOutline, mdiMagnify, mdiPackageVariantClosed } from '@mdi/js'

const open = defineModel<boolean | null>({ default: null })

const shop = [
  { title: 'Home', icon: mdiHomeOutline, to: '/' },
  { title: 'Search', icon: mdiMagnify, to: '/search' },
  { title: 'Cart', icon: mdiCartOutline, to: '/cart' },
  { title: 'Wishlists', icon: mdiHeartOutline, to: '/wishlists' },
  { title: 'Orders', icon: mdiPackageVariantClosed, to: '/orders' },
  { title: 'Account', icon: mdiAccountOutline, to: '/account' },
]
const tools = [
  { title: 'Lab', icon: mdiFlaskOutline, to: '/dev' },
  { title: 'Legacy demo', icon: mdiHistory, to: '/legacy' },
]
</script>

<template>
  <v-navigation-drawer v-model="open">
    <v-list nav>
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

<script setup lang="ts">
import { mdiAccountCircleOutline, mdiAccountOutline, mdiFlaskOutline, mdiHeartOutline, mdiPackageVariantClosed, mdiWarehouse } from '@mdi/js'

// The shopper's things, and the staff side of the store (inventory, the lab).
const { me } = useMe()
</script>

<template>
  <v-menu>
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        :icon="mdiAccountCircleOutline"
        aria-label="Account"
      />
    </template>
    <v-list
      density="compact"
      min-width="240"
    >
      <v-list-item
        v-if="me"
        :title="me.name"
        :subtitle="me.email"
      />
      <v-divider class="my-1" />
      <v-list-item
        :prepend-icon="mdiAccountOutline"
        to="/account"
        title="Account"
      />
      <v-list-item
        :prepend-icon="mdiPackageVariantClosed"
        to="/orders"
        title="Orders"
      />
      <v-list-item
        :prepend-icon="mdiHeartOutline"
        to="/wishlists"
        title="Wishlists"
      />
      <v-divider class="my-1" />
      <v-list-subheader>Staff</v-list-subheader>
      <v-list-item
        :prepend-icon="mdiWarehouse"
        to="/inventory"
        title="Inventory"
      />
      <v-list-item
        :prepend-icon="mdiFlaskOutline"
        to="/dev"
        title="Lab"
      />
    </v-list>
  </v-menu>
</template>

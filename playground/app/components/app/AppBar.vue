<script setup lang="ts">
import { mdiCartOutline, mdiHeartOutline, mdiMagnify, mdiMenu } from '@mdi/js'

// Brand, search, the connection, the shopper's things, and, on a wide
// screen, the categories underneath.
defineEmits<{ toggleNav: [] }>()
const { count } = useCart()
const { lgAndUp } = useDisplay()
</script>

<template>
  <v-app-bar
    flat
    border="b"
    height="68"
    :extended="lgAndUp"
    extension-height="44"
  >
    <!-- Lined up with the page: the same centred width as its content. -->
    <v-container
      class="d-flex align-center py-0 px-2 px-sm-4"
      style="max-width: 1280px"
    >
      <v-app-bar-nav-icon
        :icon="mdiMenu"
        class="d-lg-none"
        aria-label="Menu"
        @click="$emit('toggleNav')"
      />
      <BrandLogo class="ms-1 me-6" />
      <div
        class="d-none d-md-block flex-grow-1"
        style="max-width: 560px"
      >
        <SearchBox />
      </div>
      <v-spacer />
      <v-btn
        :icon="mdiMagnify"
        to="/search"
        class="d-md-none"
        aria-label="Search"
      />
      <SyncIndicator class="mx-1" />
      <v-btn
        :icon="mdiHeartOutline"
        to="/wishlists"
        class="d-none d-sm-flex"
        aria-label="Wishlists"
      />
      <AccountMenu />
      <v-btn
        to="/cart"
        aria-label="Cart"
        icon
      >
        <v-badge
          :model-value="count > 0"
          :content="count"
          :max="99"
          color="primary"
        >
          <v-icon :icon="mdiCartOutline" />
        </v-badge>
      </v-btn>
    </v-container>

    <template #extension>
      <v-container
        class="py-0 px-2"
        style="max-width: 1280px"
      >
        <CategoryMenuBar />
      </v-container>
    </template>
  </v-app-bar>
</template>

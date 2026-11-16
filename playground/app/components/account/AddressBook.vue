<script setup lang="ts">
import { mdiPlus } from '@mdi/js'
import type { Address, AddressFields } from '~/composables/useAccount'

// The address book. An address added offline can be made the default, or
// edited, before it syncs: those changes wait for it.
const { addresses, loading, create, update, remove, setDefault } = useAddresses()
const pending = usePendingRows('Address')
const editing = ref<Address | null>(null)
const formOpen = ref(false)

function add() {
  editing.value = null
  formOpen.value = true
}
function edit(address: Address) {
  editing.value = address
  formOpen.value = true
}
function save(fields: Partial<AddressFields>) {
  if (editing.value) void update.mutate({ id: editing.value.id, ...fields })
  else void create.mutate({ input: fields as AddressFields })
}
</script>

<template>
  <section>
    <div class="d-flex align-center mb-4">
      <h2 class="text-title-large font-weight-bold me-auto">
        Addresses
      </h2>
      <v-btn
        :prepend-icon="mdiPlus"
        variant="tonal"
        @click="add"
      >
        Add an address
      </v-btn>
    </div>
    <v-skeleton-loader
      v-if="loading && !addresses.length"
      type="card"
    />
    <p
      v-else-if="!addresses.length"
      class="text-body-medium text-medium-emphasis"
    >
      No addresses yet.
    </p>
    <v-row v-else>
      <v-col
        v-for="address in addresses"
        :key="address.id"
        cols="12"
        sm="6"
      >
        <AddressCard
          :address="address"
          :pending="pending.has(address.id)"
          :busy="setDefault.loading.value || remove.loading.value"
          manage
          @edit="edit(address)"
          @default="setDefault.mutate({ id: address.id })"
          @delete="remove.mutate({ id: address.id })"
        />
      </v-col>
    </v-row>
    <AddressForm
      v-model="formOpen"
      :address="editing"
      @save="save"
    />
  </section>
</template>

<script setup lang="ts">
import type { Address } from '~/composables/useAccount'

// An address, as a card that can be chosen (at checkout) or managed (in the account).
defineProps<{ address: Address, selected?: boolean, pending?: boolean, manage?: boolean, busy?: boolean }>()
defineEmits<{ edit: [], delete: [], default: [] }>()
</script>

<template>
  <v-card
    border
    flat
    :color="selected ? 'primary' : undefined"
    :variant="selected ? 'tonal' : 'flat'"
    class="pa-4 h-100 d-flex flex-column"
  >
    <div class="d-flex align-center ga-2 mb-1">
      <span class="text-title-small font-weight-bold">{{ address.name }}</span>
      <v-chip
        v-if="address.isDefault"
        size="x-small"
        color="primary"
        variant="tonal"
      >
        Default
      </v-chip>
      <PendingChip v-if="pending" />
    </div>
    <div class="text-body-medium text-medium-emphasis flex-grow-1">
      {{ address.line1 }}<template v-if="address.line2">
        , {{ address.line2 }}
      </template><br>
      {{ address.city }}, {{ address.region }} {{ address.postalCode }}
    </div>
    <div
      v-if="manage"
      class="d-flex ga-1 mt-3"
    >
      <v-btn
        size="small"
        variant="text"
        @click="$emit('edit')"
      >
        Edit
      </v-btn>
      <v-btn
        v-if="!address.isDefault"
        size="small"
        variant="text"
        :disabled="busy"
        @click="$emit('default')"
      >
        Make default
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        color="error"
        :loading="busy"
        :disabled="busy"
        @click="$emit('delete')"
      >
        Delete
      </v-btn>
    </div>
  </v-card>
</template>

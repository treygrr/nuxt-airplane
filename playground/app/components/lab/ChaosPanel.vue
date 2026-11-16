<script setup lang="ts">
// The server's chaos settings. Counts ("drop the next N") run down as the
// server uses them; the panel shows what is left.
const { chaos, load, set } = useLab()
onMounted(load)

const counts = [
  { key: 'dropNext', label: 'Drop next', hint: 'Requests closed without an answer, before they run' },
  { key: 'loseNext', label: 'Lose answers', hint: 'Mutations applied, then the answer dropped' },
  { key: 'rateLimitNext', label: 'Rate limit next', hint: '429 with Retry-After' },
  { key: 'unavailableNext', label: '503 next', hint: 'The server is busy' },
] as const

const timings = [
  { key: 'latencyMs', label: 'Latency', suffix: 'ms' },
  { key: 'jitterMs', label: 'Jitter', suffix: 'ms' },
  { key: 'mutationWorkMs', label: 'Mutation work', suffix: 'ms' },
  { key: 'retryAfterSeconds', label: 'Retry-After', suffix: 's' },
] as const
</script>

<template>
  <v-card
    title="Chaos"
    subtitle="How the server misbehaves"
  >
    <v-card-text v-if="chaos">
      <v-row dense>
        <v-col
          v-for="field in timings"
          :key="field.key"
          cols="6"
          md="3"
        >
          <v-number-input
            :model-value="chaos[field.key]"
            :label="field.label"
            :suffix="field.suffix"
            :min="0"
            :step="field.suffix === 's' ? 1 : 50"
            density="compact"
            control-variant="stacked"
            hide-details
            @update:model-value="set({ [field.key]: $event })"
          />
        </v-col>
      </v-row>

      <v-row
        dense
        class="mt-2"
      >
        <v-col
          v-for="field in counts"
          :key="field.key"
          cols="6"
          md="3"
        >
          <v-number-input
            :model-value="chaos[field.key]"
            :label="field.label"
            :hint="field.hint"
            :min="0"
            density="compact"
            control-variant="stacked"
            persistent-hint
            @update:model-value="set({ [field.key]: $event })"
          />
        </v-col>
      </v-row>

      <v-row
        dense
        class="mt-2"
        align="center"
      >
        <v-col
          cols="12"
          sm="7"
        >
          <v-slider
            :model-value="chaos.dropRate * 100"
            label="Drop rate"
            :min="0"
            :max="100"
            :step="5"
            thumb-label
            hide-details
            @end="set({ dropRate: $event / 100 })"
          />
        </v-col>
        <v-col
          cols="12"
          sm="5"
        >
          <v-btn-toggle
            :model-value="chaos.scope"
            density="compact"
            variant="outlined"
            mandatory
            divided
            @update:model-value="set({ scope: $event })"
          >
            <v-btn value="mutations">
              Mutations
            </v-btn>
            <v-btn value="all">
              All requests
            </v-btn>
          </v-btn-toggle>
        </v-col>
        <v-col
          cols="12"
          sm="6"
        >
          <v-switch
            :model-value="chaos.sessionExpired"
            label="Session expired"
            color="error"
            density="compact"
            hide-details
            @update:model-value="set({ sessionExpired: !!$event })"
          />
        </v-col>
        <v-col
          cols="12"
          sm="6"
        >
          <v-switch
            :model-value="chaos.honorIdempotency"
            label="Honor idempotency keys"
            color="primary"
            density="compact"
            hide-details
            @update:model-value="set({ honorIdempotency: !!$event })"
          />
        </v-col>
      </v-row>

      <RejectMutation class="mt-2" />
    </v-card-text>
    <v-skeleton-loader
      v-else
      type="paragraph"
    />
  </v-card>
</template>

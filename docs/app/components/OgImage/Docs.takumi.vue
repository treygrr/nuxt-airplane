<script setup lang="ts">
defineOptions({
  inheritAttrs: false
})

defineProps<{
  headline?: string
  title?: string
  description?: string
}>()
</script>

<template>
  <div
    class="w-full h-full flex bg-neutral-950 relative overflow-hidden"
    data-theme="dark"
  >
    <div class="absolute top-0 left-0 w-1.5 h-full bg-primary-400" />

    <div class="flex flex-col justify-between flex-1 px-20 py-16">
      <div />

      <div class="flex flex-col gap-5">
        <span
          v-if="headline"
          class="text-2xl font-medium text-primary-400"
        >
          {{ headline }}
        </span>

        <h1
          v-if="title"
          class="text-6xl font-bold text-highlighted"
        >
          {{ title }}
        </h1>

        <p
          v-if="description"
          class="text-3xl/11 text-muted"
          :style="{ lineClamp: 2, textOverflow: 'ellipsis' }"
        >
          {{ description }}
        </p>
      </div>

      <div class="flex items-center gap-4">
        <!-- The nuxt-airplane logo, as docs/public/logo.svg has it. -->
        <svg
          class="size-12"
          viewBox="140 150 960 960"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient
              id="network-magenta-purple"
              x1="0"
              y1="0"
              x2="1"
              y2="1"
            >
              <stop
                offset="0"
                stop-color="#ff13b1"
              /><stop
                offset="0.52"
                stop-color="#ed0dc0"
              /><stop
                offset="1"
                stop-color="#b40ed7"
              />
            </linearGradient>
            <clipPath id="wifi-ends"><path d="M620 938.3 L180 669.5 L180 300 L1060 300 L1060 669.5 Z" /></clipPath>
          </defs>
          <g
            id="graphql-shadow"
            transform="translate(0 18)"
            fill="#65067f"
          >
            <path
              d="M620 247 L309 437 L309 804 L620 994 L932 804 L932 437 Z"
              fill="none"
              stroke="#65067f"
              stroke-width="51"
              stroke-linejoin="round"
            />
            <circle
              cx="620"
              cy="247"
              r="79"
            />
            <circle
              cx="309"
              cy="437"
              r="81"
            />
            <circle
              cx="932"
              cy="437"
              r="81"
            />
            <circle
              cx="309"
              cy="804"
              r="81"
            />
            <circle
              cx="932"
              cy="804"
              r="81"
            />
            <circle
              cx="620"
              cy="994"
              r="83"
            />
          </g>
          <g
            id="graphql-network"
            fill="none"
            stroke="url(#network-magenta-purple)"
            stroke-width="51"
            stroke-linejoin="round"
          >
            <path
              id="network-edges"
              d="M620 247 L309 437 L309 804 L620 994 L932 804 L932 437 Z"
            />
          </g>
          <g
            id="graphql-nodes"
            fill="url(#network-magenta-purple)"
          >
            <circle
              id="node-top"
              cx="620"
              cy="247"
              r="79"
            />
            <circle
              id="node-upper-left"
              cx="309"
              cy="437"
              r="81"
            />
            <circle
              id="node-upper-right"
              cx="932"
              cy="437"
              r="81"
            />
            <circle
              id="node-lower-left"
              cx="309"
              cy="804"
              r="81"
            />
            <circle
              id="node-lower-right"
              cx="932"
              cy="804"
              r="81"
            />
            <circle
              id="node-bottom"
              cx="620"
              cy="994"
              r="83"
            />
          </g>
          <path
            id="airplane"
            fill="#fff"
            d="M620 406 C627 422 633 450 636 480 L640 528 L804 630 Q810 635 808 645 L806 656 L646 632 L646 648 L714 690 Q718 694 717 700 L716 708 L639 694 L633 706 L620 699 L607 706 L601 694 L524 708 L523 700 Q522 694 526 690 L594 648 L594 632 L434 656 L432 645 Q430 635 436 630 L600 528 L604 480 C607 450 613 422 620 406 Z"
          />
          <g
            id="wifi-signal"
            fill="none"
            stroke="#fff"
            stroke-width="27"
            stroke-linejoin="round"
            clip-path="url(#wifi-ends)"
          >
            <path
              id="wifi-bar-outer"
              d="M314.4 915.8 L502.2 801.1 A226 226 0 0 1 737.8 801.1 L925.6 915.8"
            />
            <path
              id="wifi-bar-middle"
              d="M341.6 960.2 L529.3 845.5 A174 174 0 0 1 710.7 845.5 L898.4 960.2"
            />
            <path
              id="wifi-bar-inner"
              d="M368.7 1004.6 L556.4 889.9 A122 122 0 0 1 683.6 889.9 L871.3 1004.6"
            />
          </g>
        </svg>
        <div class="h-px flex-1 bg-border" />
        <span class="text-xl text-dimmed">treygrr.github.io/nuxt-airplane</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { isLoading } = useLoadingIndicator()

const appear = ref(false)
const appeared = ref(false)

// The radar sweep behind the hero, in the site's primary colour: fuchsia,
// a shade darker on the light theme, where it is drawn for a light page.
const colorMode = useColorMode()
const light = computed(() => colorMode.value === 'light')
const radarColor = computed(() => (light.value ? '#c026d3' : '#e879f9'))

onMounted(() => {
  setTimeout(() => {
    appear.value = true
    setTimeout(() => {
      appeared.value = true
    }, 1000)
  }, 0)
})
</script>

<template>
  <!-- Client only: it is a WebGL canvas. It fades out towards the content below. -->
  <ClientOnly>
    <div
      class="
        pointer-events-none absolute inset-0 -z-10 overflow-hidden
        [mask-image:linear-gradient(to_bottom,black_55%,transparent)]
      "
      aria-hidden="true"
    >
      <RadarBackground
        :key="colorMode.value"
        :color="radarColor"
        :light-mode="light"
        :opacity="light ? 0.45 : 0.5"
        :speed="0.6"
        :center-x="0.72"
        :center-y="0.5"
        :scale="1.1"
        :targets="5"
        :clutter="0.2"
        :grain="0"
        :mouse-interaction="false"
        class-name="size-full"
      />
    </div>
  </ClientOnly>
  <div
    class="absolute w-full -top-px transition-all text-primary shrink-0"
    :class="[
      isLoading ? 'animate-pulse' : (appear ? '' : 'opacity-0'),
      appeared ? 'duration-[400ms]': 'duration-1000'
    ]"
  >
    <svg
      viewBox="0 0 1440 181"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class="pointer-events-none"
    >
      <mask
        id="path-1-inside-1_414_5526"
        fill="white"
      >
        <path d="M0 0H1440V181H0V0Z" />
      </mask>
      <path
        d="M0 0H1440V181H0V0Z"
        fill="url(#paint0_linear_414_5526)"
        fill-opacity="0.22"
      />
      <path
        d="M0 2H1440V-2H0V2Z"
        fill="url(#paint1_linear_414_5526)"
        mask="url(#path-1-inside-1_414_5526)"
      />
      <defs>
        <linearGradient
          id="paint0_linear_414_5526"
          x1="720"
          y1="0"
          x2="720"
          y2="181"
          gradientUnits="userSpaceOnUse"
        >
          <stop stop-color="currentColor" />
          <stop
            offset="1"
            stop-color="currentColor"
            stop-opacity="0"
          />
        </linearGradient>
        <linearGradient
          id="paint1_linear_414_5526"
          x1="0"
          y1="90.5"
          x2="1440"
          y2="90.5"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            stop-color="currentColor"
            stop-opacity="0"
          />
          <stop
            offset="0.395"
            stop-color="currentColor"
          />
          <stop
            offset="1"
            stop-color="currentColor"
            stop-opacity="0"
          />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>

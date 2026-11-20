<script setup lang="ts">
// Used from content/index.md as `:hero-title`: the animated logo, and the
// title beside it. The logo is drawn here, not loaded as an image, so the
// page can move the jet. It plays once and holds; a click plays it again.
// Hovered, the jet wobbles as if flying, and the logo presses in, further
// on a click. The jet and the signal take the text colour: white on the dark
// theme, black on the light one. The same drawing as public/logo-animated.svg.
const play = ref(0)
</script>

<template>
  <span class="flex items-center gap-4 sm:gap-6">
    <button
      type="button"
      aria-label="Play the logo animation again"
      class="
        group shrink-0 cursor-pointer rounded-lg transition-transform
        duration-150 ease-out
        hover:translate-y-0.5 hover:scale-[.96]
        focus-visible:outline-2 focus-visible:outline-offset-4
        focus-visible:outline-primary
        active:translate-y-1 active:scale-90
      "
      @click="play++"
    >
      <svg
        :key="play"
        viewBox="140 150 960 960"
        aria-hidden="true"
        class="
          size-20 text-black drop-shadow-xl transition-[filter] duration-150
          group-hover:drop-shadow-md
          group-active:drop-shadow-sm
          sm:size-28
          lg:size-32
          dark:text-white
        "
      >
        <defs>
          <linearGradient
            id="hero-logo-network"
            x1="0"
            y1="0"
            x2="1"
            y2="1"
          >
            <stop
              offset="0"
              stop-color="#ff13b1"
            />
            <stop
              offset="0.52"
              stop-color="#ed0dc0"
            />
            <stop
              offset="1"
              stop-color="#b40ed7"
            />
          </linearGradient>
          <clipPath id="hero-logo-inside">
            <path d="M620 247 L309 437 L309 804 L620 994 L932 804 L932 437 Z" />
          </clipPath>
          <clipPath id="hero-logo-wifi-ends">
            <path d="M620 938.3 L180 669.5 L180 300 L1060 300 L1060 669.5 Z" />
          </clipPath>
        </defs>
        <g clip-path="url(#hero-logo-inside)">
          <!-- Clouds that stream past while the logo is hovered, under the jet and the signal. -->
          <g
            fill="currentColor"
            opacity=".22"
          >
            <g transform="translate(360 0)">
              <g
                data-part="cloud"
                data-cloud="1"
              >
                <g transform="scale(1)">
                  <circle
                    cx="0"
                    cy="0"
                    r="42"
                  />
                  <circle
                    cx="52"
                    cy="-24"
                    r="56"
                  />
                  <circle
                    cx="110"
                    cy="0"
                    r="42"
                  />
                  <rect
                    x="0"
                    y="-10"
                    width="110"
                    height="52"
                  />
                </g>
              </g>
            </g>
            <g transform="translate(760 0)">
              <g
                data-part="cloud"
                data-cloud="2"
              >
                <g transform="scale(0.8)">
                  <circle
                    cx="0"
                    cy="0"
                    r="42"
                  />
                  <circle
                    cx="52"
                    cy="-24"
                    r="56"
                  />
                  <circle
                    cx="110"
                    cy="0"
                    r="42"
                  />
                  <rect
                    x="0"
                    y="-10"
                    width="110"
                    height="52"
                  />
                </g>
              </g>
            </g>
            <g transform="translate(560 0)">
              <g
                data-part="cloud"
                data-cloud="3"
              >
                <g transform="scale(0.6)">
                  <circle
                    cx="0"
                    cy="0"
                    r="42"
                  />
                  <circle
                    cx="52"
                    cy="-24"
                    r="56"
                  />
                  <circle
                    cx="110"
                    cy="0"
                    r="42"
                  />
                  <rect
                    x="0"
                    y="-10"
                    width="110"
                    height="52"
                  />
                </g>
              </g>
            </g>
          </g>
          <g data-part="wobble">
            <path
              data-part="plane"
              fill="currentColor"
              d="M620 406 C627 422 633 450 636 480 L640 528 L804 630 Q810 635 808 645 L806 656 L646 632 L646 648 L714 690 Q718 694 717 700 L716 708 L639 694 L633 706 L620 699 L607 706 L601 694 L524 708 L523 700 Q522 694 526 690 L594 648 L594 632 L434 656 L432 645 Q430 635 436 630 L600 528 L604 480 C607 450 613 422 620 406 Z"
            />
          </g>
          <g
            fill="none"
            stroke="currentColor"
            stroke-width="27"
            stroke-linejoin="round"
            clip-path="url(#hero-logo-wifi-ends)"
          >
            <path
              data-part="bar-outer"
              d="M314.4 915.8 L502.2 801.1 A226 226 0 0 1 737.8 801.1 L925.6 915.8"
            />
            <path
              data-part="bar-middle"
              d="M341.6 960.2 L529.3 845.5 A174 174 0 0 1 710.7 845.5 L898.4 960.2"
            />
            <path
              data-part="bar-inner"
              d="M368.7 1004.6 L556.4 889.9 A122 122 0 0 1 683.6 889.9 L871.3 1004.6"
            />
          </g>
        </g>
        <!-- Hard-edged shadow under the network; no blur. -->
        <g
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
        <path
          d="M620 247 L309 437 L309 804 L620 994 L932 804 L932 437 Z"
          fill="none"
          stroke="url(#hero-logo-network)"
          stroke-width="51"
          stroke-linejoin="round"
        />
        <g fill="url(#hero-logo-network)">
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
      </svg>
    </button>
    <!-- A step smaller than the hero's own title size, so the two lines fit beside the logo. -->
    <span class="text-4xl sm:text-6xl">GraphQL on <span class="whitespace-nowrap text-primary">Airplane Mode</span></span>
  </span>
</template>

<style scoped>
/* Played once, and it stays as it ends: the jet takes off, then each bar of
   the signal comes on in pink and settles to the text colour, one right
   after another. */
[data-part="plane"] { animation: hero-logo-takeoff 2s cubic-bezier(.2, .7, .2, 1) both; }
[data-part="bar-inner"] { animation: hero-logo-bar-inner 2s linear both; }
[data-part="bar-middle"] { animation: hero-logo-bar-middle 2s linear both; }
[data-part="bar-outer"] { animation: hero-logo-bar-outer 2s linear both; }

/* Hovered: the jet flies. Seen from above, it banks one way, its wings
   narrowing as it tips, drifts that way a little, levels out, and banks
   the other way. */
[data-part="wobble"] {
  transform-box: fill-box;
  transform-origin: center;
}
button:hover [data-part="wobble"] { animation: hero-logo-wobble 3s ease-in-out infinite; }

/* Hovered: clouds stream down past the jet, each at its own pace. Out of
   sight otherwise. */
[data-part="cloud"] { opacity: 0; }
button:hover [data-part="cloud"] { animation: hero-logo-cloud 1.6s linear infinite; }
button:hover [data-cloud="2"] { animation-duration: 2.1s; animation-delay: .5s; }
button:hover [data-cloud="3"] { animation-duration: 1.3s; animation-delay: .9s; }

@keyframes hero-logo-cloud {
  0% { transform: translateY(150px); opacity: 1; }
  100% { transform: translateY(1060px); opacity: 1; }
}
@keyframes hero-logo-takeoff {
  0% { transform: translateY(660px); opacity: 0; }
  4% { transform: translateY(660px); opacity: 1; }
  48%, 100% { transform: translateY(0); opacity: 1; }
}
@keyframes hero-logo-wobble {
  0%, 100% { transform: translate(0, 0) rotate(0) scaleX(1); }
  22% { transform: translate(-16px, -6px) rotate(-6deg) scaleX(.78); }
  45% { transform: translate(-6px, 0) rotate(-1deg) scaleX(.97); }
  55% { transform: translate(6px, 0) rotate(1deg) scaleX(.97); }
  78% { transform: translate(16px, -6px) rotate(6deg) scaleX(.78); }
}
@keyframes hero-logo-bar-inner {
  0%, 48% { opacity: 0; stroke: #ff13b1; }
  51% { opacity: 1; stroke: #ff13b1; }
  57% { opacity: 1; stroke: #ff13b1; }
  66%, 100% { opacity: 1; stroke: currentColor; }
}
@keyframes hero-logo-bar-middle {
  0%, 57% { opacity: 0; stroke: #ff13b1; }
  60% { opacity: 1; stroke: #ff13b1; }
  66% { opacity: 1; stroke: #ff13b1; }
  75%, 100% { opacity: 1; stroke: currentColor; }
}
@keyframes hero-logo-bar-outer {
  0%, 66% { opacity: 0; stroke: #ff13b1; }
  69% { opacity: 1; stroke: #ff13b1; }
  75% { opacity: 1; stroke: #ff13b1; }
  84%, 100% { opacity: 1; stroke: currentColor; }
}

/* Still, as it ends up, for whoever asks for less motion. */
@media (prefers-reduced-motion: reduce) {
  [data-part] { animation: none !important; }
}
</style>

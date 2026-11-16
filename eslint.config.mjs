// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

// Run `npx @eslint/config-inspector` to inspect the resolved config interactively
export default createConfigForNuxt({
  features: {
    // Rules for module authors
    tooling: true,
    // Rules for formatting
    stylistic: true,
  },
  dirs: {
    // Nuxt 4 keeps the app's sources under app/: pages and layouts there are routes, not components.
    src: [
      './playground',
      './playground/app',
    ],
  },
})
  .append(
    // The docs site is its own workspace with its own ESLint config.
    { ignores: ['docs/**'] },
  )

# nuxt-offline docs

Documentation site for the `nuxt-offline` module, built on the
[Nuxt UI docs template](https://github.com/nuxt-ui-templates/docs) with
[Nuxt Content](https://content.nuxt.com).

This folder is an npm workspace of the repository root, so install from there:

```bash
npm install          # at the repository root
npm run docs:dev     # http://localhost:3000
npm run docs:build
```

Content lives in `content/`:

- `index.md` is the landing page.
- `1.getting-started/`, `2.guide/` and `3.api/` become the sidebar sections; the numeric prefix sets the order.

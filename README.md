<p align="center">
  <img src="./docs/public/logo.png" width="140" height="140" alt="nuxt-airplane logo">
</p>

# nuxt-airplane

[![npm version](https://img.shields.io/npm/v/%40treygrr%2Fnuxt-airplane?color=00DC82&labelColor=020420)](https://www.npmjs.com/package/@treygrr/nuxt-airplane)
[![License](https://img.shields.io/npm/l/%40treygrr%2Fnuxt-airplane?color=00DC82&labelColor=020420)](./LICENSE)
[![Nuxt](https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt&labelColor=020420)](https://nuxt.com)

✈️ **Airplane mode for your GraphQL app.** Your Nuxt app keeps working when the Wi-Fi doesn't.

📖 **[Read the docs](https://treygrr.github.io/nuxt-airplane/)**

## 🛫 What it does

Give it a GraphQL endpoint and your `.gql` files. It hands back an app that doesn't care whether it's online.

- 🏷️ **Typed by name.** Every operation becomes `useAirplaneQuery('GetSites')` or `useMutation('RenameSite')`, typed from your schema. Typos don't compile.
- 🗄️ **Data lives on the device.** Results are stored as rows in IndexedDB, in tables worked out from your documents. Components read the tables, so a search works offline even if nobody ran it online.
- 📬 **Changes wait their turn.** A mutation shows up on screen at once and joins a queue that survives reloads. Back on the ground, the queue is sent in order.
- ↩️ **Undo before it lands.** Any change still in the queue can be rolled back, or retried if the server said no.
- 📡 **You know where you stand.** `useSync()` says whether you're online, what's pending and what failed. It can even hold the app offline on purpose.

```ts
const { data } = useAirplaneQuery('GetSites')
const rename = useMutation('RenameSite')

// On screen right away. On the server when there is one.
await rename.mutate({ id: 'site-1', name: 'Depot' })
```

## 🤔 Why it exists

Some apps get used where the signal isn't: a warehouse aisle, a basement, a delivery route, seat 23B. 📦 The people using them still need to look things up and write things down, and what they wrote down has to reach the server later. Once. In the right order.

Most GraphQL clients are built around the request. They cache answers, so a screen you visited can show up again. But a cache of answers only knows the questions that were asked, and a change made offline is a sticky note hoping for a reply. 🙏 Keeping it through a reload, sending it after the change it depends on, trying again, and letting someone take it back is usually your problem.

`nuxt-airplane` flips it around. The local database is what your app reads and writes. The network is just how it catches up. 🛬

The price: you write a small **handler** saying how each query maps to the tables. It's usually a few lines. And if your app is only ever online, you don't need this. A plain GraphQL client is simpler. 🙂

## 🚀 Get going

```sh
npm install @treygrr/nuxt-airplane
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@treygrr/nuxt-airplane'],
  airplane: {
    endpoint: 'https://api.example.com/graphql',
  },
})
```

Then follow the [getting started guide](https://treygrr.github.io/nuxt-airplane/getting-started). Handlers, the queue, auth, security and every option live in the [docs](https://treygrr.github.io/nuxt-airplane/). 📚

## 🛠️ Hacking on it

```sh
npm install
npm run dev          # playground with an in-memory GraphQL server
npm run lint
npm run test
npm run test:types
```

The playground in `playground/` is a little shop and inventory app. Switch the network off, change things, roll a few back, and go online again. See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. 🙌

## 📄 License

[MIT](./LICENSE)

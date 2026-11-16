export default defineAppConfig({
  ui: {
    colors: {
      primary: 'fuchsia',
      neutral: 'slate'
    },
    footer: {
      slots: {
        root: 'border-t border-default',
        left: 'text-sm text-muted'
      }
    }
  },
  seo: {
    siteName: 'nuxt-airplane'
  },
  header: {
    title: '',
    to: '/',
    logo: {
      alt: '',
      light: '',
      dark: ''
    },
    search: true,
    colorMode: true,
    links: [{
      'icon': 'i-simple-icons-github',
      'to': 'https://github.com/treygrr/nuxt-airplane',
      'target': '_blank',
      'aria-label': 'GitHub'
    }]
  },
  footer: {
    credits: `nuxt-airplane • © ${new Date().getFullYear()}`,
    colorMode: false,
    links: [{
      'icon': 'i-simple-icons-github',
      'to': 'https://github.com/treygrr/nuxt-airplane',
      'target': '_blank',
      'aria-label': 'nuxt-airplane on GitHub'
    }]
  },
  toc: {
    title: 'Table of Contents',
    bottom: {
      title: 'Links',
      edit: 'https://github.com/treygrr/nuxt-airplane/edit/main/docs/content',
      links: [{
        icon: 'i-lucide-star',
        label: 'Star on GitHub',
        to: 'https://github.com/treygrr/nuxt-airplane',
        target: '_blank'
      }, {
        icon: 'i-lucide-database',
        label: 'Dexie docs',
        to: 'https://dexie.org',
        target: '_blank'
      }]
    }
  }
})

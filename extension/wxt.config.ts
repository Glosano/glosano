import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['activeTab', 'scripting', 'storage', 'cookies'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: '__MSG_extName__' },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: { id: 'glosano-importer@glosano.app', strict_min_version: '128.0' },
          },
        }
      : {}),
  }),
})

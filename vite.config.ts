import { defineConfig } from 'vite';

export default defineConfig({
  // Milkdown's table components use Vue internally; the application remains vanilla TS.
  define: { __VUE_OPTIONS_API__: true, __VUE_PROD_DEVTOOLS__: false, __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false },
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' makes the site work on GitHub Pages (/tourismo-data-basis/),
// on Netlify, and later on databasis.tourismo.ge without changes.
export default defineConfig({
  plugins: [react()],
  base: './',
});

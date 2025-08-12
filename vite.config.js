// Archivo de configuración para desplegar en GitHub Pages
import { defineConfig } from 'vite';

export default defineConfig({
  // Con rutas relativas funciona en GitHub Pages (Actions sube dist/ a Pages)
  base: './',
});

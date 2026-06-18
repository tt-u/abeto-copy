import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import glsl from "vite-plugin-glsl";

// The recovered design elements (shaders + textures + geometry + decoders) live in
// `reference/`. Runtime binary assets are served from `reference/assets` (so e.g.
// `reference/assets/geometries/petal.drc` is fetched as `/geometries/petal.drc`),
// and shaders are imported via the `@shaders` alias.
export default defineConfig({
  // `compress: false` is required — the shader adapters do exact string replacements
  // that depend on the GLSL whitespace being preserved. vite-plugin-glsl@1.3's types
  // omit `compress`, but it is honoured at runtime.
  // @ts-expect-error  compress is a valid runtime option, missing from PluginOptions
  plugins: [glsl({ compress: false })],
  publicDir: fileURLToPath(new URL("./reference/assets", import.meta.url)),
  resolve: {
    alias: {
      "@shaders": fileURLToPath(new URL("./reference/shaders", import.meta.url)),
    },
  },
  server: { port: 4173, host: "127.0.0.1" },
  build: { target: "es2020", chunkSizeWarningLimit: 4000 },
});

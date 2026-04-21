import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['@opencode-ai/plugin', '@opencode-ai/sdk'],
  treeshake: true,
  minify: false,
});

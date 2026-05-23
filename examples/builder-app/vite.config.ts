import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@guidegraph/builder": fileURLToPath(new URL("../../packages/builder/src/index.ts", import.meta.url)),
      "@guidegraph/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@guidegraph/react-builder": fileURLToPath(
        new URL("../../packages/react-builder/src/index.tsx", import.meta.url)
      )
    }
  }
});

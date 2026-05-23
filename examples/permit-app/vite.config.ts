import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@guidegraph/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@guidegraph/react": fileURLToPath(new URL("../../packages/react/src/index.tsx", import.meta.url)),
      "@guidegraph/server": fileURLToPath(new URL("../../packages/server/src/index.ts", import.meta.url)),
      "@guidegraph/storage-memory": fileURLToPath(
        new URL("../../packages/storage-memory/src/index.ts", import.meta.url)
      )
    }
  }
});

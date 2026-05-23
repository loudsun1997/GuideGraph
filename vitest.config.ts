import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@guidegraph/builder": `${root}packages/builder/src/index.ts`,
      "@guidegraph/core": `${root}packages/core/src/index.ts`,
      "@guidegraph/devtools": `${root}packages/devtools/src/index.ts`,
      "@guidegraph/graph": `${root}packages/graph/src/index.ts`,
      "@guidegraph/http": `${root}packages/http/src/index.ts`,
      "@guidegraph/mcp": `${root}packages/mcp/src/index.ts`,
      "@guidegraph/react": `${root}packages/react/src/index.tsx`,
      "@guidegraph/react-builder": `${root}packages/react-builder/src/index.tsx`,
      "@guidegraph/react-graph": `${root}packages/react-graph/src/index.tsx`,
      "@guidegraph/server": `${root}packages/server/src/index.ts`,
      "@guidegraph/storage-memory": `${root}packages/storage-memory/src/index.ts`,
      "@guidegraph/storage-postgres": `${root}packages/storage-postgres/src/index.ts`
    }
  }
});

import { cp, mkdir } from 'node:fs/promises';

await mkdir(new URL('../dist/docs/', import.meta.url), { recursive: true });
// Vite builds the documentation entry; copy only the articles served by its directory.
for (const name of ['ALGORITHM.md', 'SOURCES.md']) {
  await cp(new URL(`../docs/${name}`, import.meta.url), new URL(`../dist/docs/${name}`, import.meta.url));
}
await cp(new URL('../README.md', import.meta.url), new URL('../dist/README.md', import.meta.url));
await cp(new URL('../LICENSE', import.meta.url), new URL('../dist/LICENSE', import.meta.url));
await cp(new URL('../node_modules/lucide-react/LICENSE', import.meta.url), new URL('../dist/docs/LUCIDE-LICENSE.txt', import.meta.url));
await mkdir(new URL('../dist/docs/licenses/', import.meta.url), { recursive: true });
for (const name of ['react', 'react-dom', 'marked', 'dompurify']) {
  await cp(new URL(`../node_modules/${name}/LICENSE`, import.meta.url), new URL(`../dist/docs/licenses/${name}.txt`, import.meta.url));
}
await cp(new URL('../node_modules/dompurify/LICENSE-MPL', import.meta.url), new URL('../dist/docs/licenses/dompurify-MPL.txt', import.meta.url));

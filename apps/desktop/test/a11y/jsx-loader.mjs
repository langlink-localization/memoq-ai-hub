import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const JSX_PATTERN = /\.jsx$/;

export async function load(url, context, nextLoad) {
  if (!JSX_PATTERN.test(url)) {
    return nextLoad(url, context);
  }

  const source = await readFile(new URL(url), 'utf8');
  const { code } = await transform(source, {
    loader: 'jsx',
    jsx: 'automatic',
    format: 'esm',
    target: 'node22',
    sourcefile: url
  });
  return { format: 'module', source: code, shortCircuit: true };
}

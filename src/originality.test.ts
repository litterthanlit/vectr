import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The app chrome (logo, favicon, page styles) must stay clear of the reference palette
// too; packages/core/test/core.test.ts guards the engine's recipes, themes and elements.
const DENY = ['#f3f2e9'];
const FILES = ['src/App.tsx', 'src/index.css', 'index.html', 'public/favicon.svg'];

describe('originality of the app chrome', () => {
  it.each(FILES)('%s uses none of the reference colours', (file) => {
    const text = readFileSync(resolve(__dirname, '..', file), 'utf8').toLowerCase();
    for (const c of DENY) expect(text).not.toContain(c);
  });
});

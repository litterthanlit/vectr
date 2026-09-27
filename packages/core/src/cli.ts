#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { compactDoc, describeGenerators, docToSVG, parseDoc, serializeDoc, shareURL, TEMPLATES, THEMES } from './index.js';

const HELP = `vectr — generative vector shapes from the command line

Usage
  vectr render <design.json | ->  [-o out.svg]    Render a design to SVG (stdout by default)
  vectr check  <design.json | ->                  Validate a design; prints the normalised JSON
  vectr link   <design.json | ->  [--base URL]    Print a share link that opens the design in the app
  vectr template <id>                             Print a starter design (${TEMPLATES.map((t) => t.id).join(', ')})
  vectr generators                                Print every generator and its params as JSON

A design is JSON. Everything except layer "type" is optional:
  { "theme": "ozone", "width": 1000, "height": 1000,
    "layers": [{ "type": "sphere", "rx": 15, "ry": 30, "params": { "rings": 3 } }] }
Themes: ${THEMES.map((t) => t.id).join(', ')}

Warnings about corrected or ignored fields go to stderr. Exit code 1 on unusable input.`;

function read(src: string | undefined): string {
  if (!src) throw new Error('Missing design file (use - for stdin)');
  return readFileSync(src === '-' ? 0 : src, 'utf8');
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv: string[]) {
  const [cmd, ...args] = argv;
  const load = () => {
    const { doc, warnings } = parseDoc(read(args[0]));
    for (const w of warnings) process.stderr.write(`warning: ${w}\n`);
    return doc;
  };
  switch (cmd) {
    case 'render': {
      const svg = docToSVG(load());
      const out = flag(args, '-o');
      if (out) writeFileSync(out, svg);
      else process.stdout.write(svg + '\n');
      return;
    }
    case 'check':
      process.stdout.write(serializeDoc(load()) + '\n');
      return;
    case 'link':
      process.stdout.write((await shareURL(load(), flag(args, '--base') ?? 'https://vectr-eight.vercel.app/')) + '\n');
      return;
    case 'template': {
      const t = TEMPLATES.find((x) => x.id === args[0]);
      if (!t) throw new Error(`Unknown template. Choose from: ${TEMPLATES.map((x) => x.id).join(', ')}`);
      process.stdout.write(JSON.stringify(compactDoc(t.build()), null, 2) + '\n');
      return;
    }
    case 'generators':
      process.stdout.write(JSON.stringify(describeGenerators(), null, 2) + '\n');
      return;
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      process.stdout.write(HELP + '\n');
      return;
    default:
      throw new Error(`Unknown command "${cmd}". Run "vectr help".`);
  }
}

main(process.argv.slice(2)).catch((e: unknown) => {
  process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});

// Cinderyard — entry program (Node 22, standard library only).
//
// The game itself is the static site in game/: plain files, ES modules, three.js
// loaded through an import map, no build step and no network. This program is
// only the courier. It copies game/ and screenshots/ from beside this file into
// the output directory and writes dossier.json there with buildDossier from the
// vendored make.fun library, so the dossier is byte for byte the one the gate
// rebuilds from the same files.
//
// In the grader the output directory is /output; anywhere else the environment
// variable MAKEFUN_OUTPUT_DIR names it instead:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play the game locally with `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The caps are the scorer's own (see the kit's RULES.txt, "The gate"): the text
// cap shapes the dossier bytes; the rest refuse here what the scorer would
// refuse there — over 4 screenshots or one over 256 KiB, over 993 entries or
// 48 MiB under game/.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);

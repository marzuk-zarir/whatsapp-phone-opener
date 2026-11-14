import { build } from 'esbuild';

await build({
  entryPoints: ['src/phone.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome102',
  minify: true,
  legalComments: 'none',
  outfile: 'lib/phone-number-parser.js'
});

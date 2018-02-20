/**
 * Command-line to compile continuations.
 */
import * as commander from 'commander';
import { CompilerOpts } from '../types';
import { parseArg } from '../generic';

commander.option(
  '-t, --transform <transformation>',
  'either eager, lazy, retval, original, or fudge',
  parseArg(x => x,
    (x) => /^(eager|lazy|retval|original|fudge|lazyDeep)$/.test(x),
    'invalid --transform, see --help'),
  'lazy');

commander.option(
  '-n, --new <new>',
  'either direct or wrapper',
  parseArg(x => x, x => /^(direct|wrapper)$/.test(x),
    'invalid --new, see --help'),
  'wrapper');

commander.option(
  '--es <mode>',
  'either sane or es5 (default: sane)',
  parseArg(x => x, x => /^(sane|es5)$/.test(x),
    'invalid --es, see --help'),
  'sane');

commander.option(
  '--eval',
  'Support eval',
  false);

commander.option(
  '--hofs <mode>',
  'either builtin or fill (default: builtin)',
  parseArg(x => x, x => /^(builtin|fill)$/.test(x),
    'invalid --hofs, see --help'),
  'builtin');

commander.option(
  '--js-args <mode>',
  'either simple, faithful, or full (default: simple)',
  parseArg(x => x, x => /^(simple|faithful|full)$/.test(x),
    'invalid --js-args, see --help'),
  'simple');

commander.option(
  '--getters',
  'enable support for getters/setters (default: false)',
  false)

commander.option('--require-runtime',
  `use require('stopify') to load the runtime system, which necessary to run
   on Node`,
  false);

commander.option(
  '--debug',
  'Insert suspensions between every line of code in the source program',
  false);

commander.option(
  '--func',
  'Compile a top-level function. Doesnt add runtime initialization or cleanup',
  false)

commander.arguments('<srcPath> <dstPath>');
const args = commander.parse(process.argv);

export const compilerOpts: CompilerOpts = {
  compileFunction: args.func,
  getters: args.getters,
  debug: args.debug,
  captureMethod: args.transform,
  newMethod: args.new,
  eval: args.eval,
  es: args.es,
  hofs: args.hofs,
  jsArgs: args.jsArgs,
  requireRuntime: args.requireRuntime
};

const srcPath: string = args.args[0];
const dstPath: string = args.args[1];

if (!srcPath || !dstPath) {
  throw new Error('<srcPath> or <dstPath> is required')
}

export { srcPath, dstPath }

/**
 * Entrypoint of the stopify-continuations bundle
 */

export * from './abstractRuntime';
import { Runtime } from './abstractRuntime';
import { LazyRuntime } from './lazyRuntime';
import { EagerRuntime } from './eagerRuntime';
import { RetvalRuntime } from './retvalRuntime';
import { FudgeRuntime } from './fudgeRuntime';
import { transformFile } from 'babel-core';

let savedRTS: Runtime | undefined;
export function newRTS(transform: string) : Runtime {
  if (savedRTS) {
    return savedRTS;
  }
  if (transform === 'lazy') {
    savedRTS = new LazyRuntime();
  }
  else if (transform === 'eager') {
    savedRTS = new EagerRuntime();
  }
  else if (transform === 'retval') {
    savedRTS = new RetvalRuntime();
  }
  else if (transform === 'fudge') {
    savedRTS = new FudgeRuntime();
  }
  else {
    throw new Error(`bad runtime: ${transform}`);
  }
  return savedRTS;
}
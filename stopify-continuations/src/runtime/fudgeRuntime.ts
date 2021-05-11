import * as common from './abstractRuntime';
export * from './abstractRuntime';
import { Result, Stack } from '../types';
import * as types from '../types';

class FudgedContinuationError {
  constructor(public v: any) {}

  toString() {
    return `FudgedContinuationError(${this.v})`;
  }

}

/** This runtime system doesn't actually implement any control operators.
 * Functions such as 'captureCC' are defined and will call their argument,
 * but don't save the stack.
 *
 * Unfortunately, all our program end by invoking the top continuation with
 * "done". Therefore, a program that runs correctly will terminate with
 * 'FudgedContinuationError(done)'. This is unfortunate. But, this
 * transformation still helps with debugging.
 */
export class FudgeRuntime extends common.RuntimeImpl {
  kind: types.CaptureMethod = 'fudge';

  constructor() {
    super(Infinity, Infinity);
  }

  reset(f: () => any): any {
    throw 'Not implemented';
  }

  captureCC(f: (k: any) => any): void {
    throw new common.Capture(f, []);
  }

  makeCont(stack: Stack) {
    return (v: any) => {
      throw new FudgedContinuationError(v);
    };
  }

  abstractRun(body: () => any): common.RunResult {
    try {
      const v = body();
      return { type: 'normal', value: v };
    }
    catch (exn) {
      if (exn instanceof common.Capture) {
        this.capturing = false;
        return { type: 'capture', stack: exn.stack, f: exn.f };
      }
      else if (exn instanceof common.EndTurn) {
        return { type: 'end-turn', callback: exn.callback };
      }
      else {
        return { type: 'exception', value: exn };
      }
    }
  }

  handleNew(constr: any, ...args: any[]) {
    return new constr(...args);
  }

  endTurn(callback: (onDone: (x: Result) => any) => any): never {
    throw new common.EndTurn(callback);
  }

}

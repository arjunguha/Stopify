import * as common from './abstractRuntime';
export * from './abstractRuntime';
import { Result, Stack  } from '../types';
import * as types from '../types';

export class EagerRuntime extends common.RuntimeImpl {
  kind: types.CaptureMethod = 'eager';
  eagerStack: Stack;

  constructor(stackSize: number, restoreFrames: number) {
    super(stackSize, restoreFrames);
    this.eagerStack = [];
  }

  reset(f: () => any): any {
    throw 'Not implemented';
  }

  captureCC(f: (k: (x: Result) => any) => any): any {
    this.capturing = true;
    throw new common.Capture(f, [...this.eagerStack]);
  }

  makeCont(stack: Stack) {
    return (x: Result) => {
      let restarter = () => {
        if (x.type === 'exception') {
          throw x.value;
        }
        else {
          return x.value;
        }
      };
      this.eagerStack = [...stack];
      throw new common.Restore([this.topK(restarter), ...stack], []);
    };
  }

  endTurn(callback: (onDone: (x: Result) => any) => any): never {
    throw new common.EndTurn(callback);
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
      else if (exn instanceof common.Restore) {
        return { type: 'restore', stack: exn.stack, savedStack: exn.savedStack };
      }
      else if (exn instanceof common.EndTurn) {
        return { type: 'end-turn', callback: exn.callback };
      }
      else {
        return { type: 'exception', value: exn };
      }
    }
  }
}

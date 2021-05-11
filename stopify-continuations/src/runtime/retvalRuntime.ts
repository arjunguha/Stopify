import * as common from './abstractRuntime';
export * from './abstractRuntime';
import { Result, Stack } from '../types';
import * as types from '../types';

export class RetvalRuntime extends common.RuntimeImpl {
  kind: types.CaptureMethod = 'retval';

  constructor(stackSize: number, restoreFrames: number) {
    super(stackSize, restoreFrames);
  }

  reset(f: () => any): any {
    throw 'Not implemented';
  }

  captureCC(f: (k: (x: Result) => any) => any): any {
    this.capturing = true;
    return new common.Capture(f, []);
  }

  makeCont(stack: Stack) {
    const savedStack = this.savedStack;
    this.savedStack = [];
    for(let i = stack.length - 1; i >= this.restoreFrames; i -= 1) {
      savedStack.push(stack.pop()!);
    }

    return (x: Result) => {
      let restarter = () => {
        if (x.type === 'exception') {
          throw x.value;
        }
        else {
          return x.value;
        }
      };
      return new common.Restore([this.topK(restarter), ...stack], savedStack);
    };
  }

  endTurn(callback: (onDone: (x: Result) => any) => any): never {
    throw new common.EndTurn(callback);
  }

  abstractRun(body: () => any): common.RunResult {
    try {
      const v = body();
      if (v instanceof common.Capture) {
        this.capturing = false;
        return { type: 'capture', stack: v.stack, f: v.f };
      }
      else if (v instanceof common.Restore) {
        return { type: 'restore', stack: v.stack, savedStack: v.savedStack };
      }
      else {
        return { type: 'normal', value: v };
      }
    }
    catch (exn) {
      if (exn instanceof common.EndTurn) {
        return { type: 'end-turn', callback: exn.callback };
      }
      return { type: 'exception', value: exn };
    }
  }
}

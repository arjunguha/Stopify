import * as common from './abstractRuntime';
export * from './abstractRuntime';
import { Result, Stack } from '../types';
import * as types from '../types';

export class LazyRuntime extends common.RuntimeImpl {
  kind: types.CaptureMethod = 'lazy';

  constructor(stackSize: number, restoreFrames: number) {
    super(stackSize, restoreFrames);
  }

  reset(f: () => any): any {
    try {
      return f();
    }
    catch (exn) {
      if (exn instanceof common.Capture) {
        if (this.mode !== true) {
          throw new Error('capture while restoring');
        }
        this.capturing = false;
        let f = exn.f;
        let k = this.makeCont(exn.stack);
        return this.reset(() => f((v) => this.reset(() => k(v))));
      }
      else if (exn instanceof common.Restore) {
        if (exn.savedStack.length > 0) {
          throw new Error('savedStack found within shift/reset');
        }
        let stack = exn.stack;
        this.stack = stack;
        this.mode = false;
        let frame = stack[stack.length - 1] as types.KFrameRest;
        return this.reset(() => {
          return frame.f.apply(frame.this || global, (frame.params || []) as any);
        });

      }
      else {
        throw exn;
      }
    }
  }

  captureCC(f: (k: (x: Result) => any) => any): any {
    this.capturing = true;
    throw new common.Capture(f, []);
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
      throw new common.Restore([this.topK(restarter), ...stack], savedStack);
    };
  }

  endTurn(callback: (onDone: (x: Result) => any) => any): never {
    this.savedStack = [];
    this.stack = [];
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

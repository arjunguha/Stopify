import * as assert from 'assert';
import { Result, Runtime, Stack, Mode, KFrameTop,
  KFrameRest } from '../types';
import * as types from '../types';

export type RunResult =
  { type: 'normal', value: any } |
  { type: 'exception', value: any } |
  { type: 'capture', stack: Stack, f: (value: any) => any } |
  { type: 'restore', stack: Stack, savedStack: Stack } |
  { type: 'end-turn', callback: (onDone: (x: Result) => any) => any };

// We throw this exception when a continuation value is applied. i.e.,
// captureCC applies its argument to a function that throws this exception.
export class Restore {
  constructor(public stack: Stack, public savedStack: Stack) {}
}

// We throw this exception to end the current turn and continue execution on the
// next turn.
export class EndTurn {
  constructor(public callback: (onDone: (x: Result) => any) => void) { }
}

// This class is used by all the runtimes to start the stack capturing process.
export class Capture {
  constructor(public f: (k: ((x: Result) => any)) => any, public stack: Stack) {}
}

export abstract class RuntimeImpl implements Runtime {
  kind: types.CaptureMethod;
  // Remaining number of stacks that this runtime can consume.
  remainingStack: number;

  // Part of the captured stack that get restored onto the JS Stack.
  stack: Stack;

  // Part of the stack that is saved and not restored onto the JS Stack.
  savedStack: Stack;

  // Mode of the program. `true` represents 'normal' mode while `false`
  // represents 'restore' mode.
  mode: Mode;

  /**
   *  A saved stack trace. This field is only used when a user-mode exception
   * is thrown.
   */
  public stackTrace: string[] = [];

  constructor(
    // Maximum number of frames that can be consumed by this runtime.
    public stackSize: number,

    // Number of frames to be restored from the captured stack onto the JS stack.
    public restoreFrames: number,

    // True when the instrumented program is capturing the stack.
    public capturing: boolean = false) {

    if (isFinite(stackSize)) {
      assert(restoreFrames <= stackSize,
        'Cannot restore more frames than stack size');
    }
    this.stack = [];
    this.savedStack = [];
    this.restoreFrames = restoreFrames;
    this.stackSize = stackSize;
    this.remainingStack = stackSize;
    this.mode = true;
    this.kind = undefined as any; // the worst
  }

  topK(f: () => any): KFrameTop {
    return {
      kind: 'top',
      f: () => {
        this.stack = [];
        this.mode = true;
        return f();
      },
      this: this,
    };
  }

  runtime<T>(body: () => any, onDone: (x: Result) => T): T {

    while(true) {
      const result = this.abstractRun(body);

      if (result.type === 'normal' || result.type === 'exception') {
        if (this.savedStack.length > 0) {
          const exception = result.type === 'exception';
          const ss = this.savedStack;

          const restarter: KFrameTop = this.topK(() => {
            if (exception) { throw result.value; }
            else { return result.value; }
          });

          this.stack = [restarter];

          for (let i = 0; i < this.restoreFrames && ss.length - 1 - i >= 0; i++) {
            this.stack.push(ss.pop()!);
          }
          body = () => {
            this.mode = false;
            return this.stack[this.stack.length - 1].f();
          };
        }
        else if(result.type === 'normal') {
          assert(this.mode, 'execution completed in restore mode');
          return onDone(result);
        }
        else if(result.type === 'exception') {
          assert(this.mode, `execution completed in restore mode, error was: ${result.value}`);
          const stack = this.stackTrace;
          this.stackTrace = [];
          return onDone({ type: 'exception', value: result.value, stack });
        }
      }
      else if (result.type === 'capture') {
        body = () => result.f.call(global, this.makeCont(result.stack));
      }
      else if (result.type === 'restore') {
        body = () => {
          if (result.stack.length === 0) {
            throw new Error(`Can't restore from empty stack`);
          }
          this.mode = false;
          this.stack = result.stack;
          this.savedStack = result.savedStack;
          const frame = <KFrameRest>this.stack[this.stack.length - 1];
          return this.stack[this.stack.length - 1].f.apply(frame.this || global, (frame.params || []) as any);
        };
      }
      else if (result.type === 'end-turn') {
        return result.callback(onDone);
      }
    }
  }

  /** jumper.ts and captureLogics.ts insert calls to pushTrace. */
  public pushTrace(line: string) {
    this.stackTrace.push(line);
  }

  /** jumper.ts inserts calls to clearTrace. */
  public clearTrace() {
    this.stackTrace = [];
  }

  /**
   * Called when the stack needs to be captured.
   *
   * The result type cannot be any more precise than any.
   */
  abstract captureCC(f: (k: (x: Result) => any) => any): any;

  /**
   * Wraps a stack in a function that throws an exception to discard the
   * current continuation. The exception carries the provided stack with a
   * final frame that returns the supplied value. If err is provided, instead
   * of returning the supplied value, it throws an exception with the provided
   * error.
   *
   * The result type cannot be any more precise than any.
   */
  abstract makeCont(stack: Stack): (x: Result) => any;

  /**
   * Run the `body`. It can return four types of values (in the form RunResult):
   *
   * 'normal': The execution of the body terminated normally.
   * 'capture': The execution of the body resulted in a stack capturing operation.
   * 'restore': The execution of the body resulted in a stack restoration
   *            operation.
   * 'exception': The excution of the body resulted in a userland exception.
   */
  abstract abstractRun(body: () => any): RunResult;

  abstract endTurn(callback: (onDone: (x: Result) => any) => any): never;

  abstract reset(f: () => any): any;
}

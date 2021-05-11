export type KFrame = KFrameTop | KFrameRest;

export interface KFrameTop {
  kind: 'top';
  f: () => any;
  this: any;
}

export interface KFrameRest {
  kind: 'rest';
  f: () => any;   // The function we are in
  locals: any[];  // All locals
  params: any[];  // All params
  this: any;      // The object bound to `this`
  index: number;  // At this application index
}

export type Stack = KFrame[];

// The type of execution mode, whether normally computing or restoring state
// from a captured `Stack`.
export type Mode = boolean;

export type Result =
  { type: 'normal', value: any } |
  { type: 'exception', value: any, stack: string[] };

export type CaptureMethod = 'eager' | 'retval' | 'lazy' | 'catch' | 'original' | 'fudge';

export interface Runtime {
  /**
   * Every instance of runtime has a 'kind' field that indicates the compilation
   * strategy that it supports. An alternative approach would be to have callers
   * check if the runtime is an instanceof LazyRuntime, EagerRuntime, etc.
   * But, that would allow the caller to depend on runtime-specific features.
   * The 'kind' field allows us to keep the implementation abstract, but
   * still allows callers to determine the compilation strategy for the purpose
   * of loading pre-stopified code.
   */
  kind: CaptureMethod;

  // Remaining number of stacks that this runtime can consume.
  remainingStack: number;

  stackSize: number;
  restoreFrames: number;

  mode: Mode;
  stack: Stack;

  endTurn(callback: (onDone: (x: Result) => any) => any): never;

  // Try to resume the program. If the program has been suspended externally,
  // this does nothing. Otherwise, it runs the next function in the queue.
  // resume(): any;

  // Top level function that runs a given program. Handles capture and restore
  // events that may be emitted by the program.
  runtime<T>(body: () => any, onDone: (x: Result) => T): T;

  // Called when the stack needs to be captured.
  captureCC(f: (k: (x: Result) => any) => any): void;

  reset(f: () => any): any;
}

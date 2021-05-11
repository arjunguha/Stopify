import * as babel from 'babel-core';
import * as babylon from 'babylon';
import * as t from 'babel-types';
import * as types from './types';
import * as callcc from './callcc/callcc';
import * as hygiene from '@stopify/hygiene';
import * as h from '@stopify/util';
import { Result } from '@stopify/continuations-runtime';
import * as continuationsRTS from '@stopify/continuations-runtime';
import { knowns } from './common/cannotCapture';
import * as exposeImplicitApps from './exposeImplicitApps';
import { restoreNextFrame } from './callcc/jumper';

export { flatness } from './compiler/flatness';
export { getSourceMap } from './compiler/sourceMaps';
export { default as plugin } from './callcc/callcc';
export * from './types';
export * from './runtime/sentinels';
export { knownBuiltIns } from './common/cannotCapture';

export const reserved = [
    ...knowns,
    "name",
    exposeImplicitApps.implicitsIdentifier.name,
    "$opts",
    "$result",
    "target",
    "newTarget",
    "captureLocals",
    restoreNextFrame.name,
    "frame",
    "RV_SENTINAL",
    "EXN_SENTINAL",
    "finally_rv",
    "finally_exn",
    "captureCC",
    'materializedArguments',
    'argsLen',
    '$top',
    '$S'
  ];

const visitor: babel.Visitor = {
    Program(path, state) {
        const opts: types.CompilerOpts = {
            getters: false,
            debug: false,
            captureMethod: 'lazy',
            newMethod: 'direct',
            es: 'sane',
            jsArgs: 'simple',
            requireRuntime: false,
            sourceMap: { getLine: () => null },
            // function done(r) { return $rts.onDone(r); }
            onDone: t.functionExpression(t.identifier('done'),
                [t.identifier('r')],
                t.blockStatement([
                    t.returnStatement(
                        t.callExpression(
                            t.memberExpression(
                                t.identifier('$rts'),
                                t.identifier('onDone')),
                            [t.identifier('r')]))
                        ])),
            eval2: false,
            compileMode:  'normal'
        };

        h.transformFromAst(path,
            [ [ hygiene.plugin, state.opts ] ]);
        h.transformFromAst(path,
            [ [ callcc.default, opts ] ]);
        path.stop();
    }
};

/**
 * Compiles a program to support callCC.
 *
 * @param src the program to compile, which may use callCC
 * @returns an ordinary JavaScript program
 */
export function compileFromAst(src: babel.types.Program): h.Result<string> {
    try {
        const babelOpts = {
            plugins: [ [ () => ({ visitor }), {
                reserved: [],
                global: t.memberExpression(t.identifier('$rts'), t.identifier('g'))
            } ] ],
            babelrc: false,
            ast: false,
            code: true,
            minified: false,
            comments: false,
        };

        const result = babel.transformFromAst(src, undefined, babelOpts);
        if (typeof result.code === 'string') {
            return h.ok(result.code);
        }
        else {
            return h.error('compile failed: no code returned');
        }
    }
    catch (exn) {
        return h.error(exn.toString());
    }
}


/**
 * Compiles a program to support callCC.
 *
 * @param src the program to compile, which may use callCC
 * @returns an ordinary JavaScript program
 */
export function compile(src: string): h.Result<types.Runner> {
    return h.asResult(() => babylon.parse(src).program)
        .then(p => compileFromAst(p))
        .map(code => new RunnerImpl(code));
}

class RunnerImpl implements types.Runner {

    public g: { [key: string]: any };
    private rts!: continuationsRTS.RuntimeImpl;

    constructor(private code: string) {
        this.g = Object.create(null);
    }

    run(onDone: (x: Result) => void): void {
        let stopify = continuationsRTS;
        this.rts = stopify.newRTS('lazy');

        let $rts = { g: this.g, onDone: onDone };
        return eval(this.code);
    }

    shift(f: (k: (v: any) => void) => void): void {
        return this.rts.captureCC(k => {
            return f((x: any) => k({ type: 'normal', value: x }));
        });
    }

    reset(f: () => any): any {
        return this.rts.reset(f);
    }


    processEvent(body: () => any, receiver: (x: Result) => void): void {
        this.rts.runtime(body, receiver);
    }
  }
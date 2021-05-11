import * as assert from 'assert';
const glob = require('glob');
import * as t from 'babel-types';
import * as fs from 'fs';
import * as tmp from 'tmp';
import { spawnSync } from 'child_process';
import * as continuationRTS from '@stopify/continuations-runtime/dist/src/runtime/runtime';
import { compile } from '../src/index';

// The compiler produces code that expects Stopify and its runtime compiler to
// be a global variable.
(global as any).stopify = continuationRTS;

function compileForTest(code: string) {
    let runner = compile(code).unwrap();
    runner.g.callCC = (f: any) => runner.shift(f);
    runner.g.shift = runner.g.callCC;
    runner.g.reset = (f: any) => runner.reset(f);
    runner.g.assert = assert;

    // NOTE(arjun): For testing, we are relying on the fact that runner.run
    // returns the result of eval, which will be the value of "x" below. In
    // general, the program may not end on the same turn.
    return {
        globals: runner.g,
        run: () => runner.run(x => x)
    };
}

test('escape continuations', () => {
    let { run, globals } = compileForTest(`
        function f() {
          return callCC(function(k) {
              return k(100);
              throw 23;
              return 5;
          });
        }
        result = f();
    `);
    expect(run()).toMatchObject({ type: 'normal' });
    expect(globals).toMatchObject({ result: 100 });
});

test('resume continuation three times', () => {
    let { run, globals } = compileForTest(`
        let saved = false;
        let i = 0;
        function myFun() {
            return callCC(function(k) {
                if (saved === false) {
                    saved = k;
                    return k("first");
                };
            });
        }

        function myGun() {
            let r = myFun();
            i++;
            switch (r) {
                case "first": return saved("second");
                case "second": return saved("third");
                case "third": return "done";
                default: throw "Very bad";
            }
        }
        result = myGun();
    `);
    expect(run()).toMatchObject({ type: 'normal' });
    expect(globals).toMatchObject({ result: 'done', i: 3 });
});

test('nested function state', () => {
    let { run, globals } = compileForTest(`
        function f() {
            function g() { return h() };
            function h() { throw 'original h called'; };
            callCC(function(k) { k(42); });
            h = function() { return 100; }
            return g();
        }
        result = f();
    `);
    expect(run()).toMatchObject({ type: 'normal' });
    expect(globals).toMatchObject({ result: 100 });
});

test('nested bindings', () => {
    // TODO(arjun): I don't see the point of g being a function.
    let { run, globals } = compileForTest(`
        function f() {
            function g() {}
            {
                callCC(function(k) { k(); });
                g.x = 200;
            }
            callCC(function(k) { k(); });
            return g.x;
        }
        result = f();
    `);
    expect(run()).toMatchObject({ type: 'normal' });
    expect(globals).toMatchObject({ result: 200 });
});

test('function object state should be preserved when continuation is resumed', () => {
    let { run, globals } = compileForTest(`
        function f() {
            function g() { };
            g.x = 200;
            callCC(function(k) { return k(); });
            return g.x;
        }
        result = f();
    `);
    expect(run()).toMatchObject({ type: 'normal' });
    expect(globals).toMatchObject({ result: 200 });
});

test('global state is not reset', () => {
    let { run, globals } = compileForTest(`
        let i = [];
        function F() {
            callCC(function(k) {
                i.push(10);
                k();
            });
        }
        F();
    `);

    expect(run()).toMatchObject({ type: 'normal' });
    expect(globals).toMatchObject({
        i: [10],
    });
});


test('fringe generator rest', () => {
    // This is a tree generator, built with continuations. It marks visited
    // nodes so that we don't visit more than necessary.
    let { run, globals } = compileForTest(`
        function node(left, right) {
            return { left: left, right: right, type: "node", visited: false };
        }

        function leaf(val) {
            return { type: "leaf", val: val, visited: false };
        }

        function treeLeafGen(tree) {
            let caller = "nothing yet";
            let resume = function() {
                returnLeaf(tree);
                return caller("done");
            };

            let returnLeaf = function(tree) {
                tree.visited = false;
                if (tree.type === "leaf") {
                    return callCC(function(remainingLeaves) {
                        resume = function() { remainingLeaves(void 0); };
                        caller(tree.val);
                    });
                }
                else {
                    returnLeaf(tree.left);
                    returnLeaf(tree.right);
                }
            };

            return function() {
                return callCC(function(k) {
                    caller = k;
                    resume();
                });
            };
        }

        let tree0 = leaf(3);
        let tree1 = node(leaf(1), node(leaf(2), tree3));
        let tree2 = node(leaf(10), node(leaf(20), leaf(30)));
        let gen1 = treeLeafGen(tree1);
        let gen2 = treeLeafGen(tree2);
        let r1 = gen1();
        let r2 = gen2();
        let r3 =  gen1();
    `);
    expect(run()).toMatchObject({ type: 'normal' });
    expect(globals).toMatchObject({
        r1: 1,
        r2: 10,
        r3: 2,
        tree0: { visited: false }
     });
});

test.skip('resume with an exception', () => {
    // TODO(arjun): We do not have the right API to resume with an exception.

    // /**
    //  * This tests restarting a captured continuation by throwing a value.
    //  */
    // var assert = require('assert');

    // function restartWithExn() {
    // try {
    //     f();
    // }
    // catch(e) {
    //     return e;
    // }
    // }

    // function f() {
    // return captureCC(function(k) {
    //     return g(k);
    // });
    // }

    // // `k` is a function returned by `makeCont` in the Runtime class.
    // // k : (v: any, err?: any) => any
    // function g(k) {
    // return k(null, "throw-this");
    // }

    // var result = restartWithExn();

    // console.log("Result of restart:", result);

    // assert(result == "throw-this");
});

test('shift/reset: discard context within reset', () => {
    let { run, globals } = compileForTest(`
        let r = 20 + reset(function() {
            return 300 + shift(function(k) { return 1; })
        });
    `);
    expect(run()).toMatchObject({ type: 'normal' });
    expect(globals).toMatchObject({
        r: 21
    });
});

test('shift/reset: restore context within reset', () => {
    let { run, globals } = compileForTest(`
        let r = 20 + reset(function() {
            return 300 + shift(function(k) { return k(1); })
        });
    `);
    expect(run()).toMatchObject({ type: 'normal' });
    expect(globals).toMatchObject({
        r: 321
    });
});

test('shift/reset: return to context within shift', () => {
    let { run, globals } = compileForTest(`
        let r = 20 + reset(function() {
            return 300 + shift(function(k) { return k(1) + 4000; })
        });
    `);
    expect(run()).toMatchObject({ type: 'normal' });
    expect(globals).toMatchObject({
        r: 4321
    });
});

test('shift/reset: nested reset, discard inner context', () => {
    let { run, globals } = compileForTest(`
        let r = 1 + reset(function() {
            return 20 + reset(function() {
                return 300 + shift(function(k) {
                    return 4000;
                });
            });
        });
    `);
    expect(run()).toMatchObject({ type: 'normal' });
    expect(globals).toMatchObject({
        r: 4021
    });
});

test('shift/reset: save continuation to global variable', () => {
    let { run, globals } = compileForTest(`
        let saved = false;
        let r1 = 1 + reset(function() {
            return 20 + shift(function(k) {
                saved = k;
                return 300;
            });
        });
        let r2 = saved(4000);
    `);
    expect(run()).toMatchObject({ type: 'normal' });
    expect(globals).toMatchObject({
        r1: 1 + 300,
        r2: 20 + 4000
    });
});

test('shift/reset: invoke continuation twice', () => {
    let { run, globals } = compileForTest(`
    r = reset(function() {
        return 100 + shift(function(k) {
            return k(1) + k(2);
        });
    });
    `);
    expect(run()).toMatchObject({ type: 'normal' });
    expect(globals).toMatchObject({
        r: 100 + 1 + 100 + 2
    });
});

test('shift/reset: two shifts', () => {
    let { run, globals } = compileForTest(`
    r = reset(function() {
        return 100 + shift(function(k) {
            return k(1) + k(2);
        }) + shift(function(k) {
            return k(3) + k(4);
        });
    });
    `);
    expect(run()).toMatchObject({ type: 'normal' });
    expect(globals).toMatchObject({
        r: (100 + 1 + 3) + (100 + 1 + 4) + (100 + 2 + 3) + (100 + 2 + 4)
    });
});


test('shift/reset: non-determinism', () => {
    let { run, globals } = compileForTest(`
    function choose(args) {
        return shift(function(k) {
            let results = [ ];
            for (let i = 0; i < args.length; i++) {
                results = results.concat(k(args[i]));
            }
            return results;
        });
    }

    function fail() {
        return shift(function(k) {
            return [];
        });
    }

    function driver(body) {
        return reset(function() {
            return [body()];
        });
    }

    function F() {
        return choose([1,2,3]);
    }

    results = driver(function() {
        let x = F();
        let y = F();
        if ((x + y) % 2 !== 0) {
            fail();
        }
        return x + y;
    });;
    `);
    expect(run()).toMatchObject({ type: 'normal' });
    // Prelude> [ x + y | x <- [ 1 .. 3 ], y <- [ 1 .. 3], (x + y) `mod` 2 == 0 ]
    // [2,4,4,4,6]
    expect(globals.results).toMatchObject([2,4,4,4,6]);
});
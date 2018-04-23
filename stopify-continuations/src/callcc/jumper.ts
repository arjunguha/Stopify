import * as t from 'babel-types';
import * as assert from 'assert';
import * as bh from '../babelHelpers';
import * as generic from '../generic';
import * as imm from 'immutable';
import * as capture from './captureLogics';
import { CompilerOpts } from '../types';
import { box } from './boxAssignables';
import { getLabels, AppType } from './label';
import { NodePath } from 'babel-traverse';
import { letExpression } from '../common/helpers';
import {
  isNormalMode,
  captureExn,
  endTurnExn,
  captureLocals,
  target,
  restoreNextFrame,
  stackFrameCall,
  runtime,
  runtimeStack,
  types,
} from './captureLogics';
import { fresh } from '../fastFreshId';

export { restoreNextFrame };

const newTarget = t.identifier('newTarget');
const captureFrameId = t.identifier('frame');
const matArgs = t.identifier('materializedArguments');
const restoreExn = t.memberExpression(types, t.identifier('Restore'));
const isRestoringMode = t.unaryExpression('!', isNormalMode);
const popRuntimeStack = t.callExpression(t.memberExpression(runtimeStack,
  t.identifier('pop')), []);
const argsLen = t.identifier('argsLen');
const increaseStackSize = t.expressionStatement(t.updateExpression(
  '++', t.memberExpression(runtime, t.identifier('remainingStack'))));
const decreaseStackSize = t.expressionStatement(t.updateExpression(
  '--', t.memberExpression(runtime, t.identifier('remainingStack'))));

type FunctionT = (t.FunctionExpression | t.FunctionDeclaration) & {
  localVars: t.Identifier[]
};

type Labeled<T> = T & {
  labels?: number[];
  appType?: AppType;
  __usesArgs__?: boolean
};
type CaptureFun = (path: NodePath<t.AssignmentExpression>) => void;

interface State {
  opts: CompilerOpts
}

const captureLogics: { [key: string]: CaptureFun } = {
  lazy: capture.lazyCaptureLogic,
  eager: capture.eagerCaptureLogic,
  retval: capture.retvalCaptureLogic,
  fudge: capture.fudgeCaptureLogic,
};

function isFlat(path: NodePath<t.Node>): boolean {
  return (<any>path.getFunctionParent().node).mark === 'Flat';
}

function usesArguments(path: NodePath<t.Function>) {
  let r = false;
  const visitor = {
    ReferencedIdentifier(path: NodePath<t.Identifier>) {
      if (path.node.name === 'arguments') {
        r = true;
        path.stop();
      }
    },
    Function(path: NodePath<t.Function>) {
      path.skip();
    }
  };
  path.traverse(visitor);
  return r;
}

function paramToArg(node: t.LVal) {
  if (node.type === 'Identifier') {
    return node;
  }
  else if (node.type === 'RestElement' && node.argument.type === 'Identifier') {
    return t.spreadElement(node.argument);
  }
  else {
    throw new Error(`paramToArg: expected Identifier or RestElement, received ${node.type}`);
  }
}


function func(path: NodePath<Labeled<FunctionT>>, state: State): void {
  const jsArgs = state.opts.jsArgs;
  if ((<any>path.node).mark === 'Flat') {
    return;
  }
  const restoreLocals = path.node.localVars;

  const frame = t.identifier('$frame');

  // We instrument every non-flat function to begin with a *restore block*
  // that is able to re-construct a saved stack frame. When the function is
  // invoked in restore mode, its formal arguments are already restored.
  // The restore block must restore the local variables and deal with
  // the *arguments* object. The arguments object is a real pain and hurts
  // performance. So, we avoid restoring it faithfully unless we are explicitly
  // configured to do so.
  const restoreBlock = [
    t.variableDeclaration('const', [t.variableDeclarator(frame, popRuntimeStack)]),
    t.expressionStatement(t.assignmentExpression('=', target,
      t.memberExpression(frame, t.identifier('index')))),
  ];

  if (restoreLocals.length > 0) {
    // Restore all local variables. Creates the expression:
    //   [local0, local1, ... ] = topStack.locals;
    restoreBlock.push(t.expressionStatement(t.assignmentExpression('=',
      t.arrayPattern(restoreLocals), t.memberExpression(frame,
        t.identifier('locals')))));
  }

  if (path.node.__usesArgs__ && state.opts.jsArgs === 'full') {
    // To fully support the arguments object, we need to ensure that the
    // formal parameters alias the arguments array. This restores the
    // aliases using:
    //
    //   [param0, param1, ...] = topStack.formals
    restoreBlock.push(
      t.expressionStatement(t.assignmentExpression('=',
        t.arrayPattern((<any>path.node.params)),
        t.memberExpression(frame, t.identifier('formals')))));

    restoreBlock.push(
      t.expressionStatement(t.assignmentExpression('=',
        argsLen, t.memberExpression(frame, argsLen))));
  }

  const ifRestoring = t.ifStatement(isRestoringMode,
    t.blockStatement(restoreBlock));

  // The body of a local function that saves the the current stack frame.
  const captureBody: t.Statement[] = [ ];

  // Save all local variables as an array in frame.locals.
  if (restoreLocals.length > 0) {
    captureBody.push(
      t.expressionStatement(t.assignmentExpression('=',
        t.memberExpression(captureFrameId, t.identifier('locals')),
        t.arrayExpression(restoreLocals))));
  }

  // To support 'full' arguments ...
  if (path.node.__usesArgs__ && state.opts.jsArgs === 'full') {
    // ... save a copy of the parameters in the stack frame and
    captureBody.push(t.expressionStatement(t.assignmentExpression('=',
      t.memberExpression(captureFrameId, t.identifier('formals')),
      t.arrayExpression((<any>path.node.params)))));
    // ... save the length of the arguments array in the stack frame
    captureBody.push(t.expressionStatement(t.assignmentExpression('=',
      t.memberExpression(captureFrameId, argsLen),
      argsLen)));
  }
  const captureClosure = t.functionDeclaration(captureLocals,
    [captureFrameId], t.blockStatement(captureBody));

  // A local function to restore the next stack frame
  const reenterExpr = path.node.__usesArgs__
    ? t.callExpression(t.memberExpression(path.node.id, t.identifier('apply')),
        [t.thisExpression(), matArgs])
    : t.callExpression(t.memberExpression(path.node.id, t.identifier('call')),
      [t.thisExpression(), ...<any>path.node.params.map(paramToArg)]);
  const reenterClosure = t.variableDeclaration('var', [
    t.variableDeclarator(restoreNextFrame, t.arrowFunctionExpression([],
      t.blockStatement(path.node.__usesArgs__ ?
        [t.expressionStatement(t.assignmentExpression('=',
          t.memberExpression(matArgs, t.identifier('length')),
          t.memberExpression(
            t.callExpression(t.memberExpression(t.identifier('Object'),
            t.identifier('keys')), [matArgs]), t.identifier('length')))),
          t.returnStatement(reenterExpr)] :
        [t.returnStatement(reenterExpr)])))]);

  const mayMatArgs: t.Statement[] = [];
  if (path.node.__usesArgs__) {
    const argExpr = jsArgs === 'faithful' || jsArgs === 'full'
      ? bh.arrayPrototypeSliceCall(t.identifier('arguments'))
      : t.identifier('arguments');

    mayMatArgs.push(
      t.variableDeclaration('const',
        [t.variableDeclarator(matArgs, argExpr)]));

    const boxedArgs = <imm.Set<string>>(<any>path.node).boxedArgs;

    if (jsArgs === 'faithful' || jsArgs === 'full') {
      const initMatArgs: t.Statement[] = [];
      (<t.Identifier[]>path.node.params).forEach((x, i) => {
        if (boxedArgs.contains(x.name)) {
          const cons =  t.assignmentExpression('=',
            t.memberExpression(matArgs, t.numericLiteral(i), true),
            box(t.identifier(x.name)));
            initMatArgs.push(t.expressionStatement(cons));
        }
      });
      mayMatArgs.push(bh.sIf(isNormalMode, t.blockStatement(initMatArgs)));
    }
  }

  const defineArgsLen = letExpression(argsLen,
    t.memberExpression(t.identifier('arguments'), t.identifier('length')));

  path.node.body.body.unshift(...[
    ...(state.opts.jsArgs === 'full' ? [defineArgsLen] : []),
    decreaseStackSize,
    ifRestoring,
    captureClosure,
    reenterClosure,
    ...mayMatArgs
  ]);
  path.skip();
}

function labelsIncludeTarget(labels: number[]): t.Expression {
  return labels.reduce((acc: t.Expression, lbl) =>
    bh.or(t.binaryExpression('===',  target, t.numericLiteral(lbl)), acc),
    bh.eFalse);
}

function isNormalGuarded(stmt: t.Statement): stmt is t.IfStatement {
  return (t.isIfStatement(stmt) &&
    stmt.test === isNormalMode &&
    stmt.alternate === null);
}

const jumper = {
  Identifier: function (path: NodePath<t.Identifier>, s: State): void {
    if (s.opts.jsArgs === 'full' && path.node.name === 'arguments' &&
      (t.isMemberExpression(path.parent) &&
        path.parent.property.type === 'Identifier' &&
        path.parent.property.name === 'length')) {
      path.parentPath.replaceWith(argsLen);
    } else if (s.opts.jsArgs === 'full' && path.node.name === 'arguments') {
      path.node.name = 'materializedArguments';
    }
  },

  BlockStatement: {
    exit(path: NodePath<Labeled<t.BlockStatement>>) {
      const stmts = path.node.body;
      if (stmts.length === 1) {
        return;
      }
      const blocks = generic.groupBy((x,y) =>
        isNormalGuarded(x) && isNormalGuarded(y), stmts);
      const result: t.Statement[] = [];
      for (const block of blocks) {
        if (block.length === 1) {
          result.push(block[0]);
        }
        else {
          block.forEach((stmt) => {
            assert((<t.IfStatement>stmt).test === isNormalMode);
          });
          result.push(
            bh.sIf(isNormalMode,
              t.blockStatement(block.map((stmt) =>(<t.IfStatement>stmt)
                .consequent))));
        }
      }

      path.node.body = result;
    }
  },
  ExpressionStatement: {
    exit(path: NodePath<Labeled<t.ExpressionStatement>>, s: State) {
      if (isFlat(path)) { return; }
      if (path.node.appType !== undefined &&
        path.node.appType >= AppType.Tail) {

        // Skip if the right hand-side is a flat call
        if (path.node.expression.type === 'AssignmentExpression' &&
          (<any>path.node.expression.right).mark === 'Flat') {
          // Do Nothing
        }
        else {
          captureLogics[s.opts.captureMethod](
            <any>path.get('expression'));
          return;
        }
      }

      path.replaceWith(t.ifStatement(isNormalMode, path.node));
      path.skip();
    }
  },

  "FunctionExpression|FunctionDeclaration": {
    enter(path: NodePath<Labeled<FunctionT>>, s: State) {
      path.node.__usesArgs__ = usesArguments(path);

      if ((<any>path.node).mark === 'Flat') {
        return;
      }
    },
    exit(path: NodePath<Labeled<FunctionT>>, state: State): void {
      if((<any>path.node).mark === 'Flat') {
        return;
      }

      func(path, state);

      const declTarget = bh.varDecl(target, t.nullLiteral());
      path.node.body.body.unshift(declTarget);

      // Increment the remainingStack at the last line of the function.
      // This does not break tail calls.
      path.node.body.body.push(increaseStackSize);

      if (state.opts.newMethod === 'direct') {
        path.node.localVars.push(newTarget);
        const declNewTarget = bh.varDecl(newTarget,
          t.memberExpression(t.identifier('new'), t.identifier('target')));

        path.node.body.body.unshift(declNewTarget);

        const ifConstructor = bh.sIf(newTarget,
          t.returnStatement(t.thisExpression()));
        (<any>ifConstructor).isTransformed = true;

        path.node.body.body.push(ifConstructor);
      }
    }
  },

  WhileStatement: function (path: NodePath<Labeled<t.WhileStatement>>): void {
    // No need for isFlat check here. Loops make functions not flat.
    path.node.test = bh.or(
      bh.and(isRestoringMode, labelsIncludeTarget(getLabels(path.node))),
      bh.and(isNormalMode, path.node.test));
  },

  LabeledStatement: {
    exit(path: NodePath<Labeled<t.LabeledStatement>>): void {
      if (isFlat(path)) {
        return;
      }

      path.replaceWith(bh.sIf(bh.or(isNormalMode,
        bh.and(isRestoringMode, labelsIncludeTarget(getLabels(path.node)))),
        path.node));
      path.skip();
    }
  },

  IfStatement: {
    exit(path: NodePath<Labeled<t.IfStatement>>): void {
      if ((<any>path.node).isTransformed || isFlat(path)) {
        return;
      }
      const { test, consequent, alternate } = path.node;

      const alternateCond = bh.or(
        isNormalMode,
        bh.and(isRestoringMode,
               labelsIncludeTarget(getLabels(alternate))));

      const newAlt = alternate === null ? alternate :
      t.ifStatement(alternateCond, alternate);

      const consequentCond = bh.or(
        bh.and(isNormalMode, test),
        bh.and(isRestoringMode, labelsIncludeTarget(getLabels(consequent))));

      const newIf = t.ifStatement(consequentCond, consequent, newAlt);
      path.replaceWith(newIf);
      path.skip();
    },
  },

  ReturnStatement: {
    exit(path: NodePath<Labeled<t.ReturnStatement>>, s: State): void {
      switch (path.node.appType) {
        case AppType.None: {
          if(isFlat(path)) {
            return;
          }

          if (s.opts.newMethod === 'direct') {
            const retval = fresh('retval');
            const declRetval = letExpression(retval, path.node.argument);
            const isObject = t.binaryExpression('instanceof',
              retval, t.identifier('Object'));
            const conditional = t.conditionalExpression(bh.and(newTarget,
              t.unaryExpression('!', isObject)), t.thisExpression(),
              retval);

            path.replaceWith(t.blockStatement([
              declRetval,
              increaseStackSize,
              t.returnStatement(conditional),
            ]));
            path.skip();
          } else {
            path.insertBefore(increaseStackSize);
          }

          break;
        }
        case AppType.Mixed:
          return;
        case AppType.Tail:
          // Increment the remainingStack before returning from a non-flat function.
          if(!isFlat(path)) {
            path.insertBefore(increaseStackSize);
          }

          // Labels may occur if this return statement occurs in a try block.
          const labels = getLabels(path.node);
          const ifReturn = t.ifStatement(
            isNormalMode,
            path.node,
            bh.sIf(bh.and(isRestoringMode, labelsIncludeTarget(labels)),
              t.returnStatement(stackFrameCall)));
          path.replaceWith(ifReturn);
          path.skip();
          return;
      }
    }
  },

  CatchClause: {
    exit(path: NodePath<t.CatchClause>, s: State): void {
      if (s.opts.captureMethod === 'retval' || isFlat(path)) {
        return;
      }
      const { param, body } = path.node;
      body.body.unshift(t.ifStatement(
        bh.or(
          t.binaryExpression('instanceof', param, captureExn),
          t.binaryExpression('instanceof', param, restoreExn),
          t.binaryExpression('instanceof', param, endTurnExn)),
        t.throwStatement(param)));
      path.skip();
    }
  },

  TryStatement: {
    exit(path: NodePath<t.TryStatement>) {
      // To understand what's happening here, see jumperizeTry.ts
      if (path.node.handler) {
        path.node.block.body.unshift(
          bh.sIf(bh.and(isRestoringMode,
            labelsIncludeTarget(getLabels(path.node.handler.body))),
            t.throwStatement(<t.Identifier>(<any>path.node.handler).eVar)));
      }
      if (path.node.finalizer) {
        path.node.finalizer = t.blockStatement([
          bh.sIf(t.unaryExpression('!',
            t.memberExpression(runtime, t.identifier('capturing'))),
            path.node.finalizer)]);
      }
    }
  }
};

export function plugin(): any {
  return { visitor: jumper };
}

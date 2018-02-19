import { NodePath, Visitor } from 'babel-traverse';
import * as t from 'babel-types';
import * as imm from 'immutable';
import * as types from './types';
import { runtimePath } from './common/helpers'

export const implicitsIdentifier = t.identifier('$i');

const binopTable = imm.Map<string,string>([
  ['+', 'add'],
  ['-', 'sub'],
  ['/', 'div'],
  ['*', 'mul']]);

function implicit(name: string, ...args: t.Expression[]): t.Expression {
  return t.callExpression(
    t.memberExpression(implicitsIdentifier, t.identifier(name)),
    args);
}

const implicitsPath = `${runtimePath}/implicitApps`

const visitor: Visitor = {
  Program(path: NodePath<t.Program>, state) {
    const opts: types.CompilerOpts  = state.opts;
    path.node.body.unshift(
      t.variableDeclaration('var',
      [t.variableDeclarator(implicitsIdentifier,
        !opts.requireRuntime ? t.identifier('stopify')
          : t.callExpression(t.identifier('require'),
            [t.stringLiteral(implicitsPath)]))]));
  },
  BinaryExpression(path: NodePath<t.BinaryExpression>) {
    const fun = binopTable.get(path.node.operator);
    if (typeof fun !== 'string') {
      return;
    }
    path.replaceWith(implicit(fun, path.node.left, path.node.right));
  },
  MemberExpression: {
    exit(path: NodePath<t.MemberExpression>) {
      if (!path.node.computed) {
        return;
      }
      path.node.property = implicit('toKey', path.node.property);
    }
  }
};

export function plugin() {
  return { visitor };
};

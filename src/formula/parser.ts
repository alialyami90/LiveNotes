import { lex, type Token, type Unit } from './lexer';

export type Expr =
  | { t: 'num'; value: number; unit?: Unit }
  | { t: 'str'; value: string }
  | { t: 'place'; key: string; name: string }
  | { t: 'date'; iso: string }
  | { t: 'ident'; name: string }
  | { t: 'call'; name: string; args: Expr[] }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; l: Expr; r: Expr }
  | { t: 'neg'; e: Expr }
  | { t: 'prop'; e: Expr; name: string };

class ParseError extends Error {}

/** Recursive descent over the grammar in CLAUDE.md §4.1. */
export function parse(src: string): Expr | { error: string } {
  const tokens = lex(src);
  if ('error' in tokens) return tokens;
  let pos = 0;

  const peek = () => tokens[pos];
  const isPunct = (v: string) => {
    const tok = peek();
    return tok.t === 'punct' && tok.value === v;
  };
  const expect = (v: string) => {
    if (!isPunct(v)) throw new ParseError(`expected "${v}"`);
    pos++;
  };

  const additive = (): Expr => {
    let l = mult();
    while (isPunct('+') || isPunct('-')) {
      const op = (tokens[pos++] as { value: '+' | '-' }).value;
      l = { t: 'bin', op, l, r: mult() };
    }
    return l;
  };

  const mult = (): Expr => {
    let l = unary();
    while (isPunct('*') || isPunct('/')) {
      const op = (tokens[pos++] as { value: '*' | '/' }).value;
      l = { t: 'bin', op, l, r: unary() };
    }
    return l;
  };

  const unary = (): Expr => {
    if (isPunct('-')) {
      pos++;
      return { t: 'neg', e: unary() };
    }
    return postfix();
  };

  const postfix = (): Expr => {
    let e = primary();
    while (isPunct('.')) {
      pos++;
      const tok = peek();
      if (tok.t !== 'ident') throw new ParseError('expected a property name after "."');
      pos++;
      e = { t: 'prop', e, name: tok.name };
    }
    return e;
  };

  const primary = (): Expr => {
    const tok: Token = peek();
    switch (tok.t) {
      case 'num':
        pos++;
        return tok.unit ? { t: 'num', value: tok.value, unit: tok.unit } : { t: 'num', value: tok.value };
      case 'str':
        pos++;
        return { t: 'str', value: tok.value };
      case 'place':
        pos++;
        return { t: 'place', key: tok.key, name: tok.name };
      case 'date':
        pos++;
        return { t: 'date', iso: tok.iso };
      case 'ident': {
        pos++;
        if (!isPunct('(')) return { t: 'ident', name: tok.name };
        pos++;
        const args: Expr[] = [];
        if (!isPunct(')')) {
          args.push(additive());
          while (isPunct(',')) {
            pos++;
            args.push(additive());
          }
        }
        expect(')');
        return { t: 'call', name: tok.name, args };
      }
      case 'punct':
        if (tok.value === '(') {
          pos++;
          const e = additive();
          expect(')');
          return e;
        }
        throw new ParseError(`unexpected "${tok.value}"`);
      case 'eof':
        throw new ParseError('unexpected end of formula');
    }
  };

  try {
    const e = additive();
    if (peek().t !== 'eof') throw new ParseError('unexpected input after expression');
    return e;
  } catch (e) {
    if (e instanceof ParseError) return { error: e.message };
    throw e;
  }
}

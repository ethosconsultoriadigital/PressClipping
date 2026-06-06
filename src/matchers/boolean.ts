/**
 * Evaluador de reglas booleanas simples para keywords tipo "booleana".
 *
 * Gramática soportada (operadores no sensibles a mayúsculas):
 *   expr   := term (OR term)*
 *   term   := factor (AND factor)*        // AND también implícito entre factores
 *   factor := NOT factor | '(' expr ')' | operand
 *   operand:= "frase entre comillas" | palabra
 *
 * Los operandos se evalúan con límite de palabra sobre el texto plegado.
 * Es deliberadamente simple (sin precedencias exóticas); cubre el caso de PR
 * de combinar marca + contexto y excluir ruido.
 */
import { foldText, indexOfWord } from './text.js';

type Token =
  | { t: 'AND' | 'OR' | 'NOT' | '(' | ')' }
  | { t: 'OP'; value: string };

function tokenize(regla: string): Token[] {
  const tokens: Token[] = [];
  const re = /"([^"]*)"|'([^']*)'|\(|\)|[^\s()]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(regla)) !== null) {
    const raw = m[0];
    if (raw === '(') tokens.push({ t: '(' });
    else if (raw === ')') tokens.push({ t: ')' });
    else if (m[1] !== undefined || m[2] !== undefined) {
      tokens.push({ t: 'OP', value: (m[1] ?? m[2]) as string });
    } else {
      const up = raw.toUpperCase();
      if (up === 'AND' || up === '&&' || up === 'Y' || up === '+') tokens.push({ t: 'AND' });
      else if (up === 'OR' || up === '||' || up === 'O') tokens.push({ t: 'OR' });
      else if (up === 'NOT' || up === '!' || up === 'NO' || up === '-') tokens.push({ t: 'NOT' });
      else tokens.push({ t: 'OP', value: raw });
    }
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly foldedText: string,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  parse(): boolean {
    const v = this.expr();
    return v;
  }

  private expr(): boolean {
    let value = this.term();
    while (this.peek()?.t === 'OR') {
      this.next();
      const right = this.term();
      value = value || right;
    }
    return value;
  }

  private term(): boolean {
    let value = this.factor();
    // AND explícito o implícito (dos operandos seguidos).
    while (true) {
      const tk = this.peek();
      if (!tk) break;
      if (tk.t === 'AND') {
        this.next();
        value = this.factor() && value;
      } else if (tk.t === 'NOT' || tk.t === '(' || tk.t === 'OP') {
        // AND implícito
        value = this.factor() && value;
      } else break;
    }
    return value;
  }

  private factor(): boolean {
    const tk = this.peek();
    if (!tk) return false;
    if (tk.t === 'NOT') {
      this.next();
      return !this.factor();
    }
    if (tk.t === '(') {
      this.next();
      const v = this.expr();
      if (this.peek()?.t === ')') this.next();
      return v;
    }
    if (tk.t === 'OP') {
      this.next();
      return indexOfWord(tk.value, this.foldedText) >= 0;
    }
    // Token inesperado (AND/OR/')' suelto): consúmelo para no ciclar.
    this.next();
    return false;
  }
}

/** Evalúa la regla booleana contra el texto (se pliega internamente). */
export function evalBoolean(regla: string, text: string): boolean {
  const tokens = tokenize(regla);
  if (tokens.length === 0) return false;
  return new Parser(tokens, foldText(text)).parse();
}

/** Extrae los operandos (palabras/frases) de una regla, para snippets. */
export function operandsOf(regla: string): string[] {
  return tokenize(regla)
    .filter((t): t is { t: 'OP'; value: string } => t.t === 'OP')
    .map((t) => t.value);
}

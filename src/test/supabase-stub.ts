/**
 * A stand-in for the Supabase client, so server actions can be tested.
 *
 * The actions are where the rules actually live — which shifts may be
 * removed, whether an approval survives an edit, what a correction applies —
 * and none of it was testable, because every action opens a real client on
 * the first line. That left the highest-consequence code in the app covered
 * only by inspection.
 *
 * This records every operation and returns scripted results. It deliberately
 * does NOT emulate Postgres: filters are captured as data and asserted on,
 * not executed. A test says "the update must be constrained by
 * `archived_at is null`" and this proves the action asked for that. Whether
 * the database honours it is RLS's job and is not what these tests are for.
 */

export interface StubResult {
  data?: unknown;
  /**
   * A PostgREST error. `code` is the Postgres SQLSTATE and is part of the
   * contract, not decoration: `recordPunch` treats 23505 (unique violation)
   * as SUCCESS, because a replayed offline punch has already been recorded.
   */
  error?: { message: string; code?: string; details?: string; hint?: string } | null;
  count?: number | null;
}

export interface RecordedOperation {
  table: string;
  /** select | insert | update | delete | upsert */
  verb: string;
  /** The row(s) passed to insert/update/upsert. */
  payload?: unknown;
  /** Every filter applied, in order, e.g. `{ method: "eq", args: ["id", "s1"] }`. */
  filters: { method: string; args: unknown[] }[];
  /** True when the chain ended in maybeSingle()/single(). */
  single: boolean;
}

/** Filters and terminators a chain may use. Anything else throws loudly. */
const FILTERS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "is",
  "in",
  "or",
  "not",
  "like",
  "ilike",
  "contains",
  "order",
  "limit",
  "range",
  "select",
  "match",
]);

type Responder = (op: RecordedOperation) => StubResult;

class QueryStub implements PromiseLike<StubResult> {
  constructor(
    private readonly op: RecordedOperation,
    private readonly respond: Responder,
  ) {
    // Every filter method resolves to the same recording chain.
    for (const method of FILTERS) {
      (this as Record<string, unknown>)[method] = (...args: unknown[]) => {
        // `select` after insert/update is a returning clause, not a filter,
        // so it is recorded but must not overwrite the verb.
        this.op.filters.push({ method, args });
        return this;
      };
    }
  }

  maybeSingle(): Promise<StubResult> {
    this.op.single = true;
    return Promise.resolve(this.respond(this.op));
  }

  single(): Promise<StubResult> {
    this.op.single = true;
    return Promise.resolve(this.respond(this.op));
  }

  then<TResult1 = StubResult, TResult2 = never>(
    onfulfilled?:
      | ((value: StubResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.respond(this.op)).then(onfulfilled, onrejected);
  }
}

export interface SupabaseStub {
  client: unknown;
  /** Every operation performed, in order. */
  operations: RecordedOperation[];
  /**
   * Queue a result. Matched by table and verb, in the order queued; the last
   * matching entry repeats once its queue is empty.
   */
  on(table: string, verb: string, result: StubResult): void;
  /** Operations against one table, optionally narrowed to one verb. */
  opsFor(table: string, verb?: string): RecordedOperation[];
  /** The single operation matching table+verb; throws unless exactly one. */
  onlyOp(table: string, verb: string): RecordedOperation;
}

/**
 * Structural comparison, so an array argument matches by contents.
 *
 * `.in("id", ids)` receives an array the action built itself, never the one
 * a test holds, so identity comparison would always fail.
 */
function sameArg(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return (
      actual.length === expected.length &&
      actual.every((value, i) => sameArg(value, expected[i]))
    );
  }
  return false;
}

/** Did a recorded operation apply this filter? */
export function hasFilter(
  op: RecordedOperation,
  method: string,
  ...args: unknown[]
): boolean {
  return op.filters.some(
    (f) =>
      f.method === method &&
      args.every((expected, i) => sameArg(f.args[i], expected)),
  );
}

export function createSupabaseStub(): SupabaseStub {
  const operations: RecordedOperation[] = [];
  const queues = new Map<string, StubResult[]>();
  const key = (table: string, verb: string) => `${table}:${verb}`;

  const respond: Responder = (op) => {
    const queue = queues.get(key(op.table, op.verb));
    if (!queue || queue.length === 0) {
      // Default: a successful no-op. Tests script only what they care about.
      return { data: op.single ? null : [], error: null };
    }
    return queue.length === 1 ? queue[0] : (queue.shift() as StubResult);
  };

  const start = (table: string, verb: string, payload?: unknown) => {
    const op: RecordedOperation = { table, verb, payload, filters: [], single: false };
    operations.push(op);
    return new QueryStub(op, respond) as unknown as Record<string, unknown>;
  };

  const client = {
    from(table: string) {
      return {
        select: (...args: unknown[]) => {
          const q = start(table, "select");
          (q.select as (...a: unknown[]) => unknown)(...args);
          return q;
        },
        insert: (payload: unknown) => start(table, "insert", payload),
        update: (payload: unknown) => start(table, "update", payload),
        upsert: (payload: unknown) => start(table, "upsert", payload),
        delete: () => start(table, "delete"),
      };
    },
  };

  return {
    client,
    operations,
    on(table, verb, result) {
      const k = key(table, verb);
      const queue = queues.get(k) ?? [];
      queue.push(result);
      queues.set(k, queue);
    },
    opsFor(table, verb) {
      return operations.filter(
        (o) => o.table === table && (verb === undefined || o.verb === verb),
      );
    },
    onlyOp(table, verb) {
      const found = operations.filter(
        (o) => o.table === table && o.verb === verb,
      );
      if (found.length !== 1) {
        throw new Error(
          `expected exactly one ${verb} on ${table}, saw ${found.length}: ` +
            JSON.stringify(operations.map((o) => `${o.table}.${o.verb}`)),
        );
      }
      return found[0];
    },
  };
}

/** A signed-in manager, as `requireRole` returns one. */
export const MANAGER = {
  id: "user-manager",
  organisationId: "org-1",
  role: "manager",
};

/** Build a FormData from a plain object, as a form submission would. */
export function formData(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((v) => data.append(name, v));
    else data.set(name, value);
  }
  return data;
}

/*
 * The `vi.mock` calls for next/cache, the Supabase client, auth and
 * notifications stay in each test file rather than living here. They are
 * hoisted above every import, so wrapping them in a shared helper only looks
 * tidier — vitest warns that it does not run where it appears to.
 */

import { MemoryCacheStoreFactory } from '../../../cache';
import { createWalletService, type WalletDeps } from '../wallet';

type Row = Record<string, any>;

function extractParamValues(expr: any): any[] {
  const values: any[] = [];
  const seen = new WeakSet();

  function walk(obj: any, depth: number) {
    if (depth > 20 || !obj || typeof obj !== 'object') return;
    if (seen.has(obj)) return;
    seen.add(obj);

    if ('value' in obj && obj.value !== null && obj.value !== undefined
      && typeof obj.value !== 'object' && typeof obj.value !== 'function') {
      values.push(obj.value);
    }

    if (Array.isArray(obj.queryChunks)) {
      for (const c of obj.queryChunks) walk(c, depth + 1);
    }
    if (Array.isArray(obj.chunks)) {
      for (const c of obj.chunks) walk(c, depth + 1);
    }
  }

  walk(expr, 0);
  return values;
}

function rowMatchesAllValues(row: Row, values: any[]): boolean {
  const rowVals = Object.values(row);
  return values.every((v) => rowVals.includes(v));
}

function resolveTableName(schema: any): string {
  try {
    if (schema?._?.config?.name) return schema._.config.name;
  } catch {}
  try {
    for (const sym of Object.getOwnPropertySymbols(schema)) {
      const desc = sym.toString();
      if (desc.includes('Name') || desc.includes('drizzle')) {
        const val = schema[sym];
        if (typeof val === 'string') return val;
        if (val?.config?.name) return val.config.name;
      }
    }
  } catch {}
  return 'unknown';
}

export function createMockDb() {
  const tables = new Map<string, Row[]>();
  let _seq = 0;

  function getTable(name: string): Row[] {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  }

  function nextSeq(): number {
    return ++_seq;
  }

  function buildSelectChain(selectFields?: Record<string, any>) {
    let tableName = '';
    let whereExpr: any = null;
    let limitVal: number | null = null;
    let offsetVal: number | null = null;

    const chain: any = {
      from(schema: any) {
        tableName = resolveTableName(schema);
        return chain;
      },
      where(expr: any) {
        whereExpr = expr;
        return chain;
      },
      orderBy() { return chain; },
      limit(n: number) { limitVal = n; return chain; },
      offset(n: number) { offsetVal = n; return chain; },
      groupBy() { return chain; },
      then(resolve: Function, reject?: Function) {
        try {
          let rows = [...getTable(tableName)];

          if (whereExpr) {
            const vals = extractParamValues(whereExpr);
            if (vals.length > 0) {
              rows = rows.filter((r) => rowMatchesAllValues(r, vals));
            }
          }

          rows.sort((a, b) => (b._seq ?? 0) - (a._seq ?? 0));

          if (offsetVal) rows = rows.slice(offsetVal);
          if (limitVal) rows = rows.slice(0, limitVal);

          if (selectFields) {
            rows = rows.map((r) => {
              const out: Row = {};
              for (const alias of Object.keys(selectFields)) {
                out[alias] = r[alias];
              }
              return out;
            });
          }

          resolve(rows);
        } catch (err) {
          if (reject) reject(err); else resolve([]);
        }
      },
    };

    return chain;
  }

  function buildInsertChain(tableName: string) {
    return {
      values(data: Row | Row[]) {
        const items = Array.isArray(data) ? data : [data];
        const table = getTable(tableName);
        for (const row of items) {
          table.push({ id: crypto.randomUUID(), createdAt: new Date(), _seq: nextSeq(), ...row });
        }
        return Promise.resolve();
      },
    };
  }

  const mockDb: any = {
    select(fields?: Record<string, any>) {
      return buildSelectChain(fields);
    },
    insert(schema: any) {
      return buildInsertChain(resolveTableName(schema));
    },
    _tables: tables,
    _getTable: getTable,
    _nextSeq: nextSeq,
    _clear() { tables.clear(); _seq = 0; },
  };

  return mockDb;
}

export function createTestWallet(overrides?: Partial<WalletDeps>) {
  const db = overrides?.db ?? createMockDb();
  const cacheFactory = overrides?.cacheFactory ?? new MemoryCacheStoreFactory();
  const deps: WalletDeps = { db, cacheFactory };
  return { service: createWalletService(deps), deps, db };
}

export function seedBalance(db: any, orgId: string, balanceCents: number) {
  const table = db._getTable('wallet_transactions');
  table.push({
    id: crypto.randomUUID(),
    organizationId: orgId,
    amountCents: balanceCents,
    entryType: 'credit',
    balanceAfterCents: balanceCents,
    reason: 'seed',
    referenceId: null,
    createdAt: new Date(),
    _seq: db._nextSeq(),
  });
}

export function orgId(n = 1): string {
  return `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
}

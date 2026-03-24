import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { getPool } from './pool';

let dbInstance: ReturnType<typeof drizzle> | null = null;

export function getDb(connectionString: string) {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(connectionString), { schema });
  }
  return dbInstance;
}

export { schema };
export type { sshKeys } from './schema';

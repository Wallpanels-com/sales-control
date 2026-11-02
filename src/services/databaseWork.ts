import { db } from '../db.js';
import {
  acquireDatabasePermit,
  observeSupabaseError,
  releaseDatabasePermit
} from './databaseCircuit.js';

export async function runDatabaseWork<T>(work: () => Promise<T>): Promise<{ ran: false } | { ran: true; value: T }> {
  const permit = acquireDatabasePermit();
  if (!permit) return { ran: false };
  try {
    if (permit === 'probe') {
      const { error } = await db.from('companies').select('id').limit(1);
      if (error) throw error;
    }
    return { ran: true, value: await work() };
  } catch (error) {
    observeSupabaseError(error);
    throw error;
  } finally {
    releaseDatabasePermit(permit);
  }
}

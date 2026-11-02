import { db } from '../db.js';

export interface CompanyRow {
  id: string;
  slug: string;
  display_name: string;
  location_id: string;
  timezone: string;
  conversation_url_template: string | null;
  enabled: boolean;
}

let rows: CompanyRow[] | null = null;
let loading: Promise<CompanyRow[]> | null = null;

export function setCompanyRows(next: CompanyRow[]): void {
  rows = [...next];
  loading = null;
}

export function clearCompanyRows(): void {
  rows = null;
  loading = null;
}

export async function getCompanyRows(): Promise<CompanyRow[]> {
  if (rows) return rows;
  if (!loading) {
    loading = (async () => {
      const { data, error } = await db.from('companies')
        .select('id,slug,display_name,location_id,timezone,conversation_url_template,enabled');
      if (error) throw error;
      rows = (data || []) as CompanyRow[];
      return rows;
    })().finally(() => {
      loading = null;
    });
  }
  return loading;
}

export async function getCompanyRowBySlug(slug: string): Promise<CompanyRow> {
  const row = (await getCompanyRows()).find(company => company.slug === slug);
  if (!row) throw new Error(`Company is not registered: ${slug}`);
  return row;
}

export async function getCompanyRowById(id: string): Promise<CompanyRow | null> {
  return (await getCompanyRows()).find(company => company.id === id) || null;
}

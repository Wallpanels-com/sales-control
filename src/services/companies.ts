import { db } from '../db.js';
import type { CompanyConfig } from '../types.js';
import { setCompanyRows, type CompanyRow } from './companyRegistry.js';

export async function syncCompanies(companies: CompanyConfig[]): Promise<void> {
  const payload = companies.map(c => ({
      slug: c.slug,
      display_name: c.displayName,
      location_id: c.locationId,
      enabled: true,
      conversation_url_template: c.conversationUrlTemplate || null,
      timezone: 'America/New_York'
  }));
  const { data, error } = await db.from('companies').upsert(payload, { onConflict: 'slug' })
    .select('id,slug,display_name,location_id,timezone,conversation_url_template,enabled');
  if (error) throw error;
  setCompanyRows((data || []) as CompanyRow[]);
}

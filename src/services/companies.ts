import { db } from '../db.js';
import type { CompanyConfig } from '../types.js';

export async function syncCompanies(companies: CompanyConfig[]): Promise<void> {
  for (const c of companies) {
    const { error } = await db.from('companies').upsert({
      slug: c.slug,
      display_name: c.displayName,
      location_id: c.locationId,
      enabled: true,
      conversation_url_template: c.conversationUrlTemplate || null,
      timezone: 'America/New_York'
    }, { onConflict: 'slug' });
    if (error) throw error;
  }
}

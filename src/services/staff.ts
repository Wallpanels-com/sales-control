import { readFileSync } from 'node:fs';
const seed = JSON.parse(readFileSync(new URL('../../config/staff.seed.json', import.meta.url), 'utf8')) as Array<{name:string; telegram_username:string; role:string}>;
import { db } from '../db.js';
import { normalizeName, normalizeUsername } from '../utils/text.js';
import type { CompanyConfig, GhlUser } from '../types.js';

export async function seedStaff(): Promise<void> {
  for (const person of seed) {
    const { data: existing, error: lookupError } = await db.from('staff').select('id')
      .eq('name', person.name).eq('role', person.role).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) continue;
    const { error } = await db.from('staff').insert({
      name: person.name,
      telegram_username: normalizeUsername(person.telegram_username),
      role: person.role,
      active: true
    });
    if (error) throw error;
  }
}

export async function syncGhlUsers(company: CompanyConfig, users: GhlUser[]): Promise<void> {
  const { data: companyRow, error: companyErr } = await db
    .from('companies').select('id').eq('slug', company.slug).single();
  if (companyErr) throw companyErr;

  for (const user of users) {
    const displayName = user.name || [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    const { error } = await db.from('ghl_users').upsert({
      company_id: companyRow.id,
      ghl_user_id: user.id,
      name: displayName || user.email || user.id,
      email: user.email || null,
      raw: user,
      synced_at: new Date().toISOString()
    }, { onConflict: 'company_id,ghl_user_id' });
    if (error) throw error;
  }

  // Conservative auto-map: only unique normalized exact name matches.
  const { data: staffRows, error: staffErr } = await db.from('staff').select('*').eq('active', true);
  if (staffErr) throw staffErr;
  const matchedUserIds = new Set<string>();
  for (const staff of staffRows || []) {
    const matches = users.filter(u => {
      const n = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ');
      return normalizeName(n) === normalizeName(staff.name);
    });
    if (matches.length === 1) {
      matchedUserIds.add(matches[0].id);
      const { data: existing, error: mapLookupError } = await db.from('staff_ghl_map').select('mapping_source,ghl_user_id')
        .eq('staff_id', staff.id).eq('company_id', companyRow.id).maybeSingle();
      if (mapLookupError) throw mapLookupError;
      if (existing?.mapping_source === 'manual') continue;
      const { error } = await db.from('staff_ghl_map').upsert({
        staff_id: staff.id,
        company_id: companyRow.id,
        ghl_user_id: matches[0].id,
        mapping_source: 'auto_exact_name'
      }, { onConflict: 'staff_id,company_id' });
      if (error?.code === '23505') console.warn('GHL user mapped to another staff record', { company: company.slug, ghlUserId: matches[0].id });
      else if (error) throw error;
    } else if (matches.length > 1) {
      console.warn('Ambiguous CRM staff match', { company: company.slug, staffName: staff.name, count: matches.length });
    }
  }
  const unmatched = users.filter(user => !matchedUserIds.has(user.id));
  if (unmatched.length) console.warn('Unmatched CRM users require mapping review', { company: company.slug, count: unmatched.length });
}

export async function getStaffByTelegramUsername(username: string) {
  const { data, error } = await db.from('staff')
    .select('*').eq('telegram_username', normalizeUsername(username)).eq('active', true).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getStaffByTelegramUserId(userId: number) {
  const { data: registration, error: registrationError } = await db.from('telegram_users')
    .select('*').eq('telegram_user_id', String(userId)).maybeSingle();
  if (registrationError) throw registrationError;
  if (!registration) return null;
  const { data, error } = await db.from('staff').select('*')
    .eq('id', registration.staff_id).eq('active', true).maybeSingle();
  if (error) throw error;
  return data ? { ...data, ...registration } : null;
}

export async function getTestRecipient() {
  const { data, error } = await db.from('staff').select('*')
    .eq('name', 'Dmitry').eq('role', 'admin').eq('active', true).maybeSingle();
  if (error) throw error;
  return data ? withTelegramRegistration(data) : null;
}

export async function getStaffByGhlUser(companySlug: string, ghlUserId?: string | null) {
  if (!ghlUserId) return null;
  const { data: companyRow, error: cErr } = await db.from('companies').select('id').eq('slug', companySlug).single();
  if (cErr) throw cErr;
  const { data, error } = await db.from('staff_ghl_map')
    .select('staff:staff_id(*)')
    .eq('company_id', companyRow.id)
    .eq('ghl_user_id', ghlUserId)
    .maybeSingle();
  if (error) throw error;
  const staff = (data as any)?.staff;
  const person = Array.isArray(staff) ? staff[0] : staff || null;
  return person?.active ? withTelegramRegistration(person) : null;
}

export async function getManagers() {
  const { data, error } = await db.from('staff').select('*').eq('role', 'manager').eq('active', true);
  if (error) throw error;
  return Promise.all((data || []).map(withTelegramRegistration));
}

export async function getFallbackRecipients() {
  const { data, error } = await db.from('staff').select('*').in('role', ['manager', 'admin']).eq('active', true);
  if (error) throw error;
  return Promise.all((data || []).map(withTelegramRegistration));
}

async function withTelegramRegistration(staff: any) {
  const { data, error } = await db.from('telegram_users').select('*').eq('staff_id', staff.id).maybeSingle();
  if (error) throw error;
  return data ? { ...staff, ...data, id: staff.id, telegram_registration_id: data.id } : staff;
}

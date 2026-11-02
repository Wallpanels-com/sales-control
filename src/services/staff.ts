import { readFileSync } from 'node:fs';
const seed = JSON.parse(readFileSync(new URL('../../config/staff.seed.json', import.meta.url), 'utf8')) as Array<{name:string; telegram_username:string; role:string}>;
import { db } from '../db.js';
import { normalizeName, normalizeUsername } from '../utils/text.js';
import type { CompanyConfig, GhlUser } from '../types.js';
import { getCompanyRowBySlug, getCompanyRows } from './companyRegistry.js';

const DIRECTORY_TTL_MS = 15 * 60_000;

interface StaffDirectory {
  byTelegramUsername: Map<string, any>;
  byTelegramUserId: Map<string, any>;
  byGhlUser: Map<string, any>;
  ghlUserNames: Map<string, string>;
  knownGhlUsers: Map<string, Set<string>>;
  active: any[];
}

let directory: StaffDirectory | null = null;
let directoryLoadedAt = 0;
let directoryLoading: Promise<StaffDirectory> | null = null;

export function invalidateStaffDirectory(): void {
  directory = null;
  directoryLoadedAt = 0;
  directoryLoading = null;
}

async function getStaffDirectory(): Promise<StaffDirectory> {
  if (directory && Date.now() - directoryLoadedAt < DIRECTORY_TTL_MS) return directory;
  if (!directoryLoading) {
    directoryLoading = (async () => {
      const [staffResult, telegramResult, mappingResult, ghlResult] = await Promise.all([
        db.from('staff').select('id,name,telegram_username,role,active,created_at,updated_at').eq('active', true),
        db.from('telegram_users').select('id,staff_id,telegram_user_id,telegram_chat_id,telegram_username,registered_at,updated_at'),
        db.from('staff_ghl_map').select('staff_id,company_id,ghl_user_id,mapping_source'),
        db.from('ghl_users').select('company_id,ghl_user_id,name')
      ]);
      const error = staffResult.error || telegramResult.error || mappingResult.error || ghlResult.error;
      if (error) throw error;

      const registrationByStaff = new Map((telegramResult.data || []).map(row => [row.staff_id, row]));
      const active: any[] = (staffResult.data || []).map(staff => {
        const registration = registrationByStaff.get(staff.id);
        return registration
          ? { ...staff, ...registration, id: staff.id, telegram_registration_id: registration.id }
          : staff;
      });
      const staffById = new Map(active.map(staff => [staff.id, staff]));
      const byTelegramUsername = new Map((staffResult.data || []).map(staff => [
        normalizeUsername(staff.telegram_username),
        staffById.get(staff.id)
      ]));
      const byTelegramUserId = new Map(active
        .filter(staff => staff.telegram_user_id !== undefined && staff.telegram_user_id !== null)
        .map(staff => [String(staff.telegram_user_id), staff]));
      const byGhlUser = new Map<string, any>();
      for (const mapping of mappingResult.data || []) {
        const staff = staffById.get(mapping.staff_id);
        if (staff) byGhlUser.set(`${mapping.company_id}:${mapping.ghl_user_id}`, staff);
      }
      const ghlUserNames = new Map<string, string>();
      const knownGhlUsers = new Map<string, Set<string>>();
      for (const user of ghlResult.data || []) {
        ghlUserNames.set(`${user.company_id}:${user.ghl_user_id}`, user.name);
        const ids = knownGhlUsers.get(user.company_id) || new Set<string>();
        ids.add(user.ghl_user_id);
        knownGhlUsers.set(user.company_id, ids);
      }
      directory = { byTelegramUsername, byTelegramUserId, byGhlUser, ghlUserNames, knownGhlUsers, active };
      directoryLoadedAt = Date.now();
      return directory;
    })().finally(() => {
      directoryLoading = null;
    });
  }
  return directoryLoading;
}

export async function seedStaff(): Promise<void> {
  const { data: existing, error: lookupError } = await db.from('staff').select('name,role');
  if (lookupError) throw lookupError;
  const existingKeys = new Set((existing || []).map(person => `${person.name}:${person.role}`));
  const missing = seed.filter(person => !existingKeys.has(`${person.name}:${person.role}`)).map(person => ({
      name: person.name,
      telegram_username: normalizeUsername(person.telegram_username),
      role: person.role,
      active: true
  }));
  if (missing.length) {
    const { error } = await db.from('staff').insert(missing);
    if (error) throw error;
  }
  invalidateStaffDirectory();
}

export async function syncGhlUsers(company: CompanyConfig, users: GhlUser[]): Promise<void> {
  const companyRow = await getCompanyRowBySlug(company.slug);

  const usersPayload = users.map(user => {
    const displayName = user.name || [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return {
      company_id: companyRow.id,
      ghl_user_id: user.id,
      name: displayName || user.email || user.id,
      email: user.email || null,
      raw: user,
      synced_at: new Date().toISOString()
    };
  });
  if (usersPayload.length) {
    const { error } = await db.from('ghl_users').upsert(usersPayload, { onConflict: 'company_id,ghl_user_id' });
    if (error) throw error;
  }

  // Conservative auto-map: only unique normalized exact name matches.
  const [{ data: staffRows, error: staffErr }, { data: existingMaps, error: mapError }] = await Promise.all([
    db.from('staff').select('id,name').eq('active', true),
    db.from('staff_ghl_map').select('staff_id,ghl_user_id,mapping_source').eq('company_id', companyRow.id)
  ]);
  if (staffErr || mapError) throw staffErr || mapError;
  const existingByStaff = new Map((existingMaps || []).map(mapping => [mapping.staff_id, mapping]));
  const existingByGhl = new Map((existingMaps || []).map(mapping => [mapping.ghl_user_id, mapping]));
  const matchedUserIds = new Set<string>();
  const automaticMappings: Array<{ staff_id: string; company_id: string; ghl_user_id: string; mapping_source: string }> = [];
  for (const staff of staffRows || []) {
    const matches = users.filter(u => {
      const n = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ');
      return normalizeName(n) === normalizeName(staff.name);
    });
    if (matches.length === 1) {
      matchedUserIds.add(matches[0].id);
      const existing = existingByStaff.get(staff.id);
      if (existing?.mapping_source === 'manual') continue;
      const occupied = existingByGhl.get(matches[0].id);
      if (occupied && occupied.staff_id !== staff.id) {
        console.warn('GHL user mapped to another staff record', { company: company.slug, ghlUserId: matches[0].id });
        continue;
      }
      automaticMappings.push({
        staff_id: staff.id,
        company_id: companyRow.id,
        ghl_user_id: matches[0].id,
        mapping_source: 'auto_exact_name'
      });
    } else if (matches.length > 1) {
      console.warn('Ambiguous CRM staff match', { company: company.slug, staffName: staff.name, count: matches.length });
    }
  }
  if (automaticMappings.length) {
    const { error } = await db.from('staff_ghl_map').upsert(automaticMappings, { onConflict: 'staff_id,company_id' });
    if (error) throw error;
  }
  const unmatched = users.filter(user => !matchedUserIds.has(user.id));
  if (unmatched.length) console.warn('Unmatched CRM users require mapping review', { company: company.slug, count: unmatched.length });
  invalidateStaffDirectory();
}

export async function getStaffByTelegramUsername(username: string) {
  return (await getStaffDirectory()).byTelegramUsername.get(normalizeUsername(username)) || null;
}

export async function getStaffByTelegramUserId(userId: number) {
  return (await getStaffDirectory()).byTelegramUserId.get(String(userId)) || null;
}

export async function getTestRecipient() {
  return (await getStaffDirectory()).active.find(staff => staff.name === 'Dmitry' && staff.role === 'admin') || null;
}

export async function getStaffByGhlUser(companySlug: string, ghlUserId?: string | null) {
  if (!ghlUserId) return null;
  const companyRow = await getCompanyRowBySlug(companySlug);
  return (await getStaffDirectory()).byGhlUser.get(`${companyRow.id}:${ghlUserId}`) || null;
}

export async function getManagers() {
  return (await getStaffDirectory()).active.filter(staff => staff.role === 'manager');
}

export async function getFallbackRecipients() {
  return (await getStaffDirectory()).active.filter(staff => ['manager', 'admin'].includes(staff.role));
}

export async function getKnownGhlUserIds(companySlug: string): Promise<Set<string>> {
  const companyRow = await getCompanyRowBySlug(companySlug);
  return new Set((await getStaffDirectory()).knownGhlUsers.get(companyRow.id) || []);
}

export async function getGhlUserName(companySlug: string, ghlUserId?: string | null): Promise<string | null> {
  if (!ghlUserId) return null;
  const companyRow = await getCompanyRowBySlug(companySlug);
  return (await getStaffDirectory()).ghlUserNames.get(`${companyRow.id}:${ghlUserId}`) || null;
}

export async function warmStaffDirectory(): Promise<void> {
  await getCompanyRows();
  await getStaffDirectory();
}

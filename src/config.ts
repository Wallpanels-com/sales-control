import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { z } from 'zod';
import type { CompanyConfig } from './types.js';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(10),
  TELEGRAM_BOT_TOKEN: z.string().min(10),
  TELEGRAM_BOT_USERNAME: z.string().optional().default(''),
  VERONA_LOCATION_ID: z.string().min(1),
  VERONA_API_TOKEN: z.string().min(1),
  WALLPANELS_LOCATION_ID: z.string().optional().default(''),
  WALLPANELS_API_TOKEN: z.string().optional().default(''),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().min(20).default(60),
  INITIAL_LOOKBACK_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  SLA_THRESHOLDS_MINUTES: z.string().default('60,90,120'),
  TEST_MODE: z.string().default('true').transform(v => v.toLowerCase() === 'true'),
  TEST_SLA_THRESHOLDS_MINUTES: z.string().default('2,4,5'),
  VERONA_CONVERSATION_URL_TEMPLATE: z.string().optional().default(''),
  WALLPANELS_CONVERSATION_URL_TEMPLATE: z.string().optional().default(''),
  VERONA_PREFERRED_PIPELINE_ID: z.string().optional().default(''),
  WALLPANELS_PREFERRED_PIPELINE_ID: z.string().optional().default('')
});

export const env = envSchema.parse(process.env);

function parseThresholds(value: string): number[] {
  const parsed = value.split(',').map(v => Number(v.trim())).filter(v => Number.isFinite(v) && v > 0);
  const unique = [...new Set(parsed)].sort((a, b) => a - b);
  if (unique.length !== 3) throw new Error('Exactly three distinct SLA thresholds are required');
  return unique;
}

export const thresholdsMinutes = env.TEST_MODE
  ? parseThresholds(env.TEST_SLA_THRESHOLDS_MINUTES)
  : parseThresholds(env.SLA_THRESHOLDS_MINUTES);

export const companies: CompanyConfig[] = [
  {
    slug: 'verona',
    displayName: 'Verona Home',
    locationId: env.VERONA_LOCATION_ID,
    apiToken: env.VERONA_API_TOKEN,
    conversationUrlTemplate: env.VERONA_CONVERSATION_URL_TEMPLATE || undefined,
    preferredPipelineId: env.VERONA_PREFERRED_PIPELINE_ID || undefined
  },
  ...(env.WALLPANELS_LOCATION_ID && env.WALLPANELS_API_TOKEN ? [{
    slug: 'wallpanels' as const,
    displayName: 'WallPanels',
    locationId: env.WALLPANELS_LOCATION_ID,
    apiToken: env.WALLPANELS_API_TOKEN,
    conversationUrlTemplate: env.WALLPANELS_CONVERSATION_URL_TEMPLATE || undefined,
    preferredPipelineId: env.WALLPANELS_PREFERRED_PIPELINE_ID || undefined
  }] : [])
];

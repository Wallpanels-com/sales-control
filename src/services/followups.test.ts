import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({rows:[] as any[],update:vi.fn(),send:vi.fn(),fetch:vi.fn(),from:vi.fn()}));
vi.mock('../config.js',()=>({
  companies:[{slug:'wallpanels',displayName:'WallPanels',locationId:'location',apiToken:'test-only'}],
  env:{FOLLOWUP_MODE:'production',TEST_MODE:false,AI_MODEL:'test',AI_TIMEOUT_MS:1000},
  followupCutoverAtMs:Date.parse('2026-11-01T00:00:00Z')
}));
vi.mock('../db.js',()=>({db:{from:mocks.from}}));
vi.mock('../telegram.js',()=>({bot:{api:{sendMessage:mocks.send}}}));
vi.mock('./companyRegistry.js',()=>({getCompanyRows:async()=>[{id:'company',slug:'wallpanels'}],getCompanyRowBySlug:vi.fn()}));
import { evaluateFollowups } from './followups.js';

beforeEach(()=>{
  vi.clearAllMocks();
  vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-11-16T12:00:00Z'));
  vi.stubGlobal('fetch',mocks.fetch);
  mocks.from.mockImplementation(()=>{
    const query:any={then:(resolve:any)=>Promise.resolve({data:mocks.rows,error:null}).then(resolve)};
    for(const method of ['select','eq','gte','lte','order','limit'])query[method]=vi.fn(()=>query);
    query.update=(payload:any)=>{mocks.update(payload);return query;};
    return query;
  });
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('production follow-up queue freshness gate',()=>{
  for(const [stage,hours] of [[1,312],[2,221],[1,999]]) {
    it(`suppresses stale stage ${stage} at ${hours} hours before CRM, AI or Telegram`,async()=>{
      mocks.rows=[{id:'thread',company_id:'company',conversation_id:'conversation',contact_id:'contact',
        stage,status:'waiting',anchor_at:new Date(Date.now()-hours*3600_000).toISOString(),
        due_at:new Date(Date.now()-60_000).toISOString(),last_event_key:'original-event'}];
      await evaluateFollowups(()=>true);
      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({status:'suppressed'}));
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
    });
  }
});

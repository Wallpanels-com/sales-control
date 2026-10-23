import { describe, expect, it, vi } from 'vitest';
import { FollowupAi } from './followupAi.js';
const context = [{direction:'inbound',human:false,at:'2026-10-23T10:00:00Z',text:'Could you send a quote?'}];
const result = {should_follow_up:true,confidence:0.95,reason:'customer has not replied',
  draft:'Hi! Have you had a chance to review the options? Happy to answer any questions.',defer_until:null};
function make(value: unknown, status = 200) {
  return new FollowupAi({apiKey:'test-key',model:'test-model',timeoutMs:1000,
    fetchFn:vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}),{status}))});
}
describe('follow-up AI safety',()=>{
  it('accepts a ready-to-copy English suggestion',async()=>{
    expect(await make(result).suggest(context,1)).toEqual(result);
  });
  it('rejects long drafts, provider errors and invalid structure',async()=>{
    expect(await make({...result,draft:'a'.repeat(257)}).suggest(context,1)).toBeNull();
    expect(await make(result,401).suggest(context,1)).toBeNull();
    expect(await make({draft:'only'}).suggest(context,1)).toBeNull();
  });
  it('preserves a refusal or future agreed date instead of inventing a follow-up',async()=>{
    const later={...result,should_follow_up:false,draft:'',defer_until:'2026-11-01T12:00:00Z'};
    expect(await make(later).suggest(context,1)).toEqual(later);
  });
});

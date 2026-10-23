import { describe, expect, it, vi } from 'vitest';
import { FollowupAi, addressesSalesInsteadOfCustomer } from './followupAi.js';
const context = [{direction:'inbound',human:false,at:'2026-10-23T10:00:00Z',text:'Could you send a quote?'}];
const result = {should_follow_up:true,confidence:0.95,reason:'customer has not replied',
  draft:'Hi! Have you had a chance to review the options? Happy to answer any questions.',defer_until:null};
function make(value: unknown, status = 200) {
  return new FollowupAi({apiKey:'test-key',model:'test-model',timeoutMs:1000,
    fetchFn:vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}),{status}))});
}
describe('follow-up AI safety',()=>{
  const participants={salesName:'Mary Razumna',customerName:'Elvin Richiez'};
  it('rejects the reported role reversal even when AI claims high confidence',async()=>{
    const bad={...result,draft:'Hi Mary, thanks for reaching out. I am available next Tuesday.'};
    expect(await make(bad).suggest(context,1,new Date(),participants)).toBeNull();
    expect(addressesSalesInsteadOfCustomer('Hello, Mary! Thank you.',participants)).toBe(true);
    expect(await make({...result,draft:'Hi Elvin, would you be available for a quick call about your staircase project?'}).suggest(context,1,new Date(),participants)).not.toBeNull();
  });
  it('provides explicit sender, recipient and speaker labels to the model',async()=>{
    const fetchFn=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]})));
    await new FollowupAi({apiKey:'test',model:'test',timeoutMs:1000,fetchFn}).suggest(context,1,new Date(),participants);
    const body=JSON.parse(fetchFn.mock.calls[0][1]!.body as string);
    const input=JSON.parse(body.messages[1].content);
    expect(input.participants).toEqual({sender:{role:'sales',name:'Mary Razumna'},recipient:{role:'customer',name:'Elvin Richiez'}});
    expect(input.conversation[0].speaker).toBe('customer');
  });
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

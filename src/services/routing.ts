import { HighLevelClient } from '../highlevel/client.js';
import type { CompanyConfig, GhlOpportunity } from '../types.js';

function opportunitySortKey(opp: GhlOpportunity): number {
  const value = opp.dateUpdated || opp.lastStageChangeAt || opp.lastStatusChangeAt || '';
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

export async function resolveResponsibleGhlUser(
  company: CompanyConfig,
  conversationId: string,
  contactId: string
): Promise<{ ghlUserId: string | null; source: string; mismatch?: { opportunityOwner?: string; conversationOwner?: string; contactOwner?: string } }> {
  const ghl = new HighLevelClient(company);
  const [opps, conversation, contact] = await Promise.all([
    ghl.getOpenOpportunities(contactId).catch(error => {
      console.warn('Opportunity owner lookup failed; using conversation/contact fallback', {
        company: company.slug, error: error instanceof Error ? error.message : 'unknown'
      });
      return [];
    }),
    ghl.getConversation(conversationId).catch(() => null),
    ghl.getContact(contactId).catch(() => null)
  ]);

  const sortedOpps = [...opps].sort((a, b) =>
    Number(Boolean(b.pipelineId && b.pipelineId === company.preferredPipelineId)) - Number(Boolean(a.pipelineId && a.pipelineId === company.preferredPipelineId))
    || opportunitySortKey(b) - opportunitySortKey(a)
    || a.id.localeCompare(b.id));
  const opportunityOwner = sortedOpps.find(o => o.assignedTo)?.assignedTo;
  const conversationOwner = conversation?.assignedTo;
  const contactOwner = contact?.assignedTo || contact?.assignedUserId || contact?.ownerId;

  const selected = opportunityOwner || conversationOwner || contactOwner || null;
  const source = opportunityOwner ? 'opportunity_owner' : conversationOwner ? 'conversation_assigned_user' : contactOwner ? 'contact_owner' : 'unassigned';

  const uniqueOwners = [...new Set([opportunityOwner, conversationOwner, contactOwner].filter(Boolean))];
  const mismatch = uniqueOwners.length > 1 ? { opportunityOwner, conversationOwner, contactOwner } : undefined;
  return { ghlUserId: selected, source, mismatch };
}

export type CompanySlug = 'verona' | 'wallpanels';

export interface CompanyConfig {
  slug: CompanySlug;
  displayName: string;
  locationId: string;
  apiToken: string;
  conversationUrlTemplate?: string;
  preferredPipelineId?: string;
}

export interface GhlMessage {
  id: string;
  altId?: string;
  messageType?: string;
  locationId: string;
  contactId: string;
  conversationId: string;
  dateAdded: string;
  body?: string;
  direction: 'inbound' | 'outbound';
  status?: string;
  contentType?: string;
  attachments?: string[];
  files?: string[];
  source?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface ConversationDetails {
  id: string;
  contactId: string;
  locationId: string;
  assignedTo?: string;
  deleted?: boolean;
  inbox?: boolean;
  unreadCount?: number;
  [key: string]: unknown;
}

export interface GhlOpportunity {
  id: string;
  contactId?: string;
  assignedTo?: string;
  status?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  lastStageChangeAt?: string;
  lastStatusChangeAt?: string;
  dateUpdated?: string;
  [key: string]: unknown;
}

export interface GhlUser {
  id: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  [key: string]: unknown;
}

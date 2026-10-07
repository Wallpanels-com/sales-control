import { z } from 'zod';
import { env } from '../config.js';

const classificationSchema = z.object({
  needs_reply: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(300)
}).strict();

const groqResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() })
  })).min(1)
});

export interface AiConversationMessage {
  direction: 'inbound' | 'outbound';
  humanOutbound: boolean;
  text: string;
}

export interface AiClassification {
  needsReply: boolean;
  confidence: number;
  reason: string;
  model: string;
  classifiedAt: string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class GroqInboundClassifier {
  constructor(private readonly options: {
    apiKey: string;
    model: string;
    timeoutMs: number;
    fetchFn?: FetchLike;
  }) {}

  private fallback(reason: string): AiClassification {
    return {
      needsReply: true,
      confidence: 0,
      reason,
      model: this.options.model,
      classifiedAt: new Date().toISOString()
    };
  }

  async classify(latestMessage: string, context: AiConversationMessage[]): Promise<AiClassification> {
    if (!this.options.apiKey) return this.fallback('fallback: missing_api_key');
    if (!latestMessage.trim()) return this.fallback('fallback: non_text_message');

    const fetchFn = this.options.fetchFn || fetch;
    try {
      const response = await fetchFn('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(this.options.timeoutMs),
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.options.model,
          reasoning_effort: 'low',
          max_completion_tokens: 300,
          messages: [
            {
              role: 'system',
              content: [
                'Classify whether the latest inbound customer message requires a real human sales reply or action.',
                'Use the conversation context and meaning, not keywords.',
                'needs_reply=false is allowed only for a pure acknowledgement, gratitude, or closing message with no question, request, correction, unresolved issue, promised follow-up, or action expected from sales.',
                'Any question or request about price, quote, design, product, scheduling, delivery, installation, next steps, or an unresolved problem requires needs_reply=true.',
                'If ambiguous, return needs_reply=true. Keep the reason short and do not include personal data.'
              ].join(' ')
            },
            {
              role: 'user',
              content: JSON.stringify({
                conversation_context: context.map(item => ({
                  speaker: item.direction === 'inbound' ? 'customer' : item.humanOutbound ? 'sales_human' : 'sales_automated',
                  message: item.text
                })),
                latest_inbound_message: latestMessage
              })
            }
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'inbound_reply_classification',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  needs_reply: { type: 'boolean' },
                  confidence: { type: 'number', minimum: 0, maximum: 1 },
                  reason: { type: 'string', minLength: 1, maxLength: 300 }
                },
                required: ['needs_reply', 'confidence', 'reason'],
                additionalProperties: false
              }
            }
          }
        })
      });

      if (!response.ok) {
        return this.fallback(response.status === 429 ? 'fallback: rate_limit' : `fallback: http_${response.status}`);
      }
      const envelope = groqResponseSchema.parse(await response.json());
      const parsed = classificationSchema.parse(JSON.parse(envelope.choices[0].message.content));
      return {
        needsReply: parsed.needs_reply,
        confidence: parsed.confidence,
        reason: parsed.reason.trim(),
        model: this.options.model,
        classifiedAt: new Date().toISOString()
      };
    } catch (error) {
      const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return this.fallback(timeout ? 'fallback: timeout' : 'fallback: invalid_or_unavailable');
    }
  }
}

export const inboundClassifier = new GroqInboundClassifier({
  apiKey: env.GROQ_API_KEY,
  model: env.AI_MODEL,
  timeoutMs: env.AI_TIMEOUT_MS
});

export function suppressesSlaIncident(classification: Pick<AiClassification, 'needsReply' | 'confidence'>, threshold = env.AI_CONFIDENCE_THRESHOLD): boolean {
  return classification.needsReply === false && classification.confidence >= threshold;
}

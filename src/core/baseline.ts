import { segmentSentences } from './text';
import { CATEGORY_IDS, LIMITS, type Candidate, type CategoryId, type Interval, type ReasonCode } from './types';

/**
 * Keyless rules engines.
 * - strict: reason-scoped patterns; evidence is the containing sentence (or clause when the sentence is
 *   longer than the evidence limit), never the trigger word. Negation is scoped per reason and per clause.
 * - loose: a keyword baseline for evaluation only, never the default scan.
 * Neither engine caps its output: display limits are applied later so evaluation sees full recall.
 */

export const RULES_VERSION = 'rules-strict/1';
export const LOOSE_VERSION = 'rules-loose/1';

interface Rule {
  categoryId: CategoryId;
  reasonCode: Exclude<ReasonCode, 'unspecified'>;
  explanation: string;
  /** Any trigger match inside a sentence proposes the reason. */
  triggers: RegExp[];
  /** Every pattern must match somewhere in the sentence (context such as "personal data"). */
  requires?: RegExp[];
  /** Reason-specific negations, tested only against the clause that holds the trigger. */
  negations?: RegExp[];
}

const DATA = /\b(?:personal (?:data|information)|your (?:personal )?(?:data|information)|information (?:about you|we collect)|(?:user|customer|usage|location) data|data (?:about|we collect))\b/i;
const CONTENT = /\b(?:content|photos?|images?|videos?|posts?|submissions?|uploads?|materials?|messages?|recordings?|works?)\b|\byou (?:submit|post|upload|share|provide)\b/i;
const LICENCE = /\b(?:licen[cs]e[sd]?|right to (?:use|reproduce|copy|modify)|grant(?:s|ed)? (?:us|to us|the company))\b/i;
const SUBSCRIPTION = /\b(?:subscri\w*|plan|membership|renew\w*|billing|billed|trial)\b/i;
const NOT_VERB = (verbs: string) => new RegExp(`\\b(?:do|does|did|will|shall|would|can|may)\\s+not\\s+(?:\\w+\\s+){0,2}?(?:${verbs})\\b`, 'i');
const NEVER_VERB = (verbs: string) => new RegExp(`\\bnever\\s+(?:\\w+\\s+){0,1}?(?:${verbs})\\b`, 'i');

const RULES: readonly Rule[] = [
  // auto_renewal
  {
    categoryId: 'auto_renewal',
    reasonCode: 'auto_renews',
    explanation: 'The plan renews or keeps billing unless you cancel.',
    triggers: [
      /\bauto(?:matically)?[- ]?renew(?:s|ed|al|ing)?\b/i,
      /\brenew(?:s|ed)?\s+(?:\w+\s+)?automatically\b/i,
      /\bcontinue[sd]?\s+to\s+(?:bill|charge)\b/i,
      /\brecurring\s+(?:billing|charges?|payments?|subscription|fees?)\b/i,
    ],
    negations: [
      NOT_VERB('auto-?renew|automatically renew|renew'),
      /\bnot\s+(?:be\s+)?(?:set\s+to\s+)?auto(?:matically)?[- ]?renew/i,
      /\bno\s+(?:auto(?:matic)?[- ]?renewal|recurring)\b/i,
      NEVER_VERB('auto-?renew|renew|automatically renew'),
      /\bdoes\s+not\s+(?:\w+\s+)?recur\b/i,
    ],
  },
  {
    categoryId: 'auto_renewal',
    reasonCode: 'price_change_on_renewal',
    explanation: 'The renewal price can change.',
    triggers: [
      /\b(?:price|fee|rate|charge)s?\b[^.;]{0,80}\b(?:may|can|will|could|might)\s+(?:change|increase|rise|be\s+(?:adjusted|increased|changed))\b/i,
      /\brenew\w*\b[^.;]{0,80}\bat\s+(?:the\s+|our\s+)?(?:then[- ]current|current|new|prevailing|standard|full)\s+(?:price|rate|fee)/i,
      /\b(?:increase|change|adjust|raise)\s+(?:the\s+|our\s+|your\s+)?(?:price|fee|rate|subscription fee)s?\b/i,
    ],
    requires: [SUBSCRIPTION],
    negations: [
      NOT_VERB('change|increase|raise|rise|be adjusted|be increased'),
      /\bprice\s+(?:is\s+)?(?:locked|guaranteed|fixed)\b/i,
      NEVER_VERB('increase|raise|change'),
    ],
  },
  {
    categoryId: 'auto_renewal',
    reasonCode: 'cancel_hurdle',
    explanation: 'Cancelling requires an extra step, notice period or penalty.',
    triggers: [
      /\bcancel\w*\b[^.;]{0,100}\b(?:only\s+(?:by|through|via)|must\s+(?:call|contact|write|mail|send|speak)|by\s+(?:phone|telephone|calling|mail|post|certified\s+mail|written\s+notice|fax)|in\s+person)\b/i,
      /\bcancel\w*\b[^.;]{0,80}\bat\s+least\s+\d+\s+(?:days?|hours?|business\s+days?)\b/i,
      /\b(?:cancellation|early\s+termination)\s+(?:fee|penalty|charge)\b/i,
      /\bno\s+(?:refunds?|partial\s+refunds?)\b[^.;]{0,80}\bcancel/i,
      /\bcancel\w*\b[^.;]{0,80}\bno\s+(?:refunds?|partial\s+refunds?)\b/i,
    ],
    requires: [SUBSCRIPTION],
    negations: [/\bno\s+(?:cancellation|early\s+termination)\s+(?:fee|penalty|charge)\b/i, NOT_VERB('charge (?:a |any )?(?:cancellation|termination) fee')],
  },
  // arbitration
  {
    categoryId: 'arbitration',
    reasonCode: 'binding_arbitration',
    explanation: 'Disputes go to binding private arbitration instead of court.',
    triggers: [
      /\b(?:binding|final\s+and\s+binding|mandatory|individual)\s+arbitration\b/i,
      /\b(?:resolved|settled|decided|determined)\s+(?:exclusively\s+|solely\s+|only\s+)?(?:by|through|in)\s+(?:confidential\s+)?arbitration\b/i,
      /\bsubmit(?:ted)?\s+(?:\w+\s+){0,3}to\s+(?:binding\s+)?arbitration\b/i,
      /\barbitration\s+(?:shall|will)\s+be\s+(?:final|binding|the\s+exclusive)/i,
      /\bagree(?:s)?\s+to\s+arbitrat(?:e|ion)\b/i,
    ],
    negations: [
      /\b(?:not|never)\s+(?:be\s+)?(?:required|subject|obligated)\s+to\s+(?:binding\s+|mandatory\s+)?arbitrat/i,
      /\bno\s+(?:binding\s+|mandatory\s+)?arbitration\b/i,
      NOT_VERB('require (?:binding |mandatory )?arbitration|use (?:binding |mandatory )?arbitration'),
    ],
  },
  {
    categoryId: 'arbitration',
    reasonCode: 'class_action_waiver',
    explanation: 'You give up joining or bringing a class or collective action.',
    triggers: [
      /\bclass[- ]action\s+waiver\b/i,
      /\bwaive\w*\s+(?:\w+\s+){0,4}?class(?:[- ]wide)?\s+(?:action|arbitration|proceeding|claim)s?\b/i,
      /\bwaive\w*\b[^.;]{0,80}\b(?:participate|join|bring)\s+(?:in\s+)?(?:a\s+|any\s+)?class(?:[- ]wide)?\s+(?:action|arbitration|proceeding|claim)s?\b/i,
      /\b(?:may|will|shall|can)\s+not\s+(?:bring|participate\s+in|join|pursue|act\s+as\s+\w+\s+in)\s+(?:a\s+|any\s+)?(?:class|collective|representative)\b/i,
      /\bonly\s+(?:on\s+an\s+|in\s+(?:your|their|an)\s+)individual\s+(?:basis|capacity)\b/i,
      /\bno\s+class\s+(?:actions?|arbitrations?)\b/i,
    ],
    negations: [/\b(?:does|do|will|shall)\s+not\s+(?:waive|prevent|prohibit|restrict|limit)\b[^.;]{0,60}\bclass\b/i],
  },
  {
    categoryId: 'arbitration',
    reasonCode: 'jury_waiver',
    explanation: 'You give up a jury trial.',
    triggers: [
      /\bwaive\w*\s+(?:\w+\s+){0,5}?(?:trial\s+by\s+(?:a\s+)?jury|jury\s+trial|jury)\b/i,
      /\bjury\s+(?:trial\s+)?waiver\b/i,
      /\bwaiver\s+of\s+(?:\w+\s+){0,4}?jury\b/i,
      /\bwithout\s+a\s+jury\b/i,
    ],
    negations: [/\b(?:does|do|will|shall)\s+not\s+waive\b/i],
  },
  // unilateral_change
  {
    categoryId: 'unilateral_change',
    reasonCode: 'modify_any_time',
    explanation: 'The provider can change the terms on its own.',
    triggers: [
      /\b(?:we|us|the\s+company)\s+(?:may|can|will|might)\s+(?:\w+\s+){0,3}?(?:modify|change|update|amend|revise|replace)\s+(?:these|this|the|our|any\s+part\s+of\s+(?:these|this|the))\s+(?:terms|agreement|policy|privacy\s+policy|conditions|terms\s+of\s+(?:service|use))\b/i,
      /\breserves?\s+the\s+right\s+(?:\w+\s+){0,3}?to\s+(?:\w+\s+){0,2}?(?:modify|change|amend|revise|update|replace)\b[^.;]{0,60}\b(?:terms|agreement|policy|conditions)\b/i,
      /\b(?:terms|agreement|policy)\s+(?:may|can)\s+be\s+(?:modified|changed|amended|revised|updated)\s+(?:by\s+us\s+)?(?:at\s+any\s+time|from\s+time\s+to\s+time|without)/i,
    ],
    negations: [
      NOT_VERB('modify|change|amend|revise|update'),
      NEVER_VERB('modify|change|amend|revise|update'),
      /\bonly\s+with\s+your\s+(?:written\s+)?(?:consent|agreement)\b/i,
    ],
  },
  {
    categoryId: 'unilateral_change',
    reasonCode: 'notice_by_posting',
    explanation: 'Changes take effect when posted, without direct notice.',
    triggers: [
      /\b(?:by|upon|when\s+we)\s+post(?:ing)?\s+(?:the\s+|a\s+)?(?:revised|updated|new|modified|amended|changed)\b/i,
      /\beffective\s+(?:immediately\s+)?(?:upon|when|on)\s+(?:posting|posted|publication)\b/i,
      /\bcontinued\s+(?:use|access)\b[^.;]{0,120}\b(?:constitutes|means|signifies|indicates|is)\s+(?:your\s+)?(?:acceptance|agreement|consent)\b/i,
      /\b(?:it\s+is\s+)?your\s+responsibility\s+to\s+(?:check|review)\b[^.;]{0,60}\b(?:periodically|regularly|for\s+changes|for\s+updates)\b/i,
    ],
    // Assent by use alone is not an amendment right: require change context in the sentence.
    requires: [/\b(?:chang\w*|modif\w*|revis\w*|updat\w*|amend\w*)\b/i],
    negations: [/\bwe\s+will\s+(?:email|notify|tell|send)\b[^.;]{0,40}\bbefore\b/i],
  },
  // data_sale_or_share
  {
    categoryId: 'data_sale_or_share',
    reasonCode: 'sale',
    explanation: 'Personal information can be sold.',
    triggers: [
      /\b(?:we|us)\s+(?:\w+\s+){0,3}?(?:sell|sells|rent|trade|license)\b/i,
      /\b(?:sale|selling|renting)\s+of\s+(?:your\s+)?(?:personal\s+)?(?:data|information)\b/i,
      /\b(?:is|are|may\s+be|will\s+be|can\s+be)\s+(?:\w+\s+)?sold\b/i,
    ],
    requires: [DATA],
    negations: [
      NOT_VERB('sell|rent|trade'),
      NEVER_VERB('sell|rent|trade'),
      /\b(?:is|are|will\s+be)\s+(?:never|not)\s+(?:be\s+)?sold\b/i,
      /\bno\s+sale\b/i,
    ],
  },
  {
    categoryId: 'data_sale_or_share',
    reasonCode: 'sharing_advertising',
    explanation: 'Personal information is shared for advertising or marketing.',
    triggers: [
      /\b(?:share|shares|disclose|discloses|provide|transfer|make\s+available)\b[^.;]{0,100}\b(?:advertis\w*|ad\s+networks?|marketing\s+partners|marketers|targeted\s+ads?)\b/i,
      /\b(?:advertis\w*|marketing)\s+partners\b[^.;]{0,60}\b(?:receive|access|collect)\b/i,
    ],
    requires: [DATA],
    negations: [NOT_VERB('share|disclose|provide|transfer'), NEVER_VERB('share|disclose|provide|transfer')],
  },
  {
    categoryId: 'data_sale_or_share',
    reasonCode: 'sharing_third_party',
    explanation: 'Personal information is shared with third parties.',
    triggers: [
      /\b(?:we|us)\s+(?:\w+\s+){0,3}?(?:share|disclose|provide|transfer)\b[^.;]{0,100}\b(?:third[- ]part(?:y|ies)|partners|affiliates|vendors|service\s+providers|other\s+companies|data\s+brokers|sponsors)\b/i,
      /\b(?:may|will|can)\s+(?:\w+\s+)?(?:share|disclose)\b[^.;]{0,100}\b(?:third[- ]part(?:y|ies)|partners|affiliates|vendors|data\s+brokers|sponsors)\b/i,
      /\b(?:is|are|may\s+be)\s+(?:shared|disclosed)\s+(?:with|to)\b/i,
    ],
    requires: [DATA],
    negations: [NOT_VERB('share|disclose|provide|transfer'), NEVER_VERB('share|disclose|provide|transfer')],
  },
  // liability_cap
  {
    categoryId: 'liability_cap',
    reasonCode: 'damages_cap',
    explanation: 'The provider caps the money it will pay.',
    triggers: [
      /\b(?:total|aggregate|entire|cumulative|maximum)\s+liability\b[^.;]{0,160}\b(?:shall|will|does)\s+not\s+exceed\b/i,
      /\bliability\b[^.;]{0,40}\b(?:is|shall\s+be|will\s+be)\s+limited\s+to\b/i,
      /\bliability\b[^.;]{0,80}\b(?:limited|capped)\s+(?:to|at)\s+(?:the\s+)?(?:amount|fees|greater|lesser|\$|US\$|USD|one\s+hundred|\d)/i,
      /\bnot\s+to\s+exceed\s+(?:the\s+)?(?:amount|fees|\$|US\$|\d)/i,
    ],
    negations: [
      /\bliability\s+(?:is|shall\s+be|will\s+be)\s+not\s+limited\b/i,
      NOT_VERB('limit (?:our|its|the company.s) liability'),
      /\bnothing\s+in\s+(?:these|this)\s+\w+\s+(?:limits|excludes|restricts)\b/i,
    ],
  },
  {
    categoryId: 'liability_cap',
    reasonCode: 'exclusion_of_damages',
    explanation: 'The provider excludes liability for some damages.',
    triggers: [
      /\bin\s+no\s+event\s+(?:shall|will)\b[^.;]{0,100}\b(?:be\s+)?liable\b/i,
      /\b(?:not|never)\s+be\s+(?:liable|responsible)\s+for\s+(?:any\s+)?(?:indirect|incidental|special|consequential|punitive|exemplary|lost|loss|damages)/i,
      /\b(?:disclaim|disclaims|exclude|excludes)\s+(?:all\s+|any\s+)?liability\b/i,
      /\b(?:are|is)\s+not\s+liable\s+for\s+(?:any\s+)?(?:indirect|incidental|special|consequential|punitive|lost|loss|damages)/i,
    ],
    negations: [/\bnothing\s+in\s+(?:these|this)\s+\w+\s+(?:limits|excludes|restricts)\b/i],
  },
  // broad_content_license
  {
    categoryId: 'broad_content_license',
    reasonCode: 'perpetual_irrevocable',
    explanation: 'The licence to your content never ends or cannot be withdrawn.',
    triggers: [/\b(?:perpetual|irrevocable)\b/i],
    requires: [LICENCE, CONTENT],
    negations: [
      /\b(?:do|does|will)\s+not\s+(?:grant|give)\s+us\b/i,
      /\bnot\s+(?:a\s+)?(?:perpetual|irrevocable)\b/i,
      /\b(?:non-?perpetual|revocable)\b/i,
    ],
  },
  {
    categoryId: 'broad_content_license',
    reasonCode: 'sublicensable',
    explanation: 'The provider can pass rights in your content to others.',
    triggers: [
      /\bsub-?licen[cs]e?able\b/i,
      /\b(?:right|rights)\s+to\s+sub-?licen[cs]e\b/i,
      /\bsub-?licen[cs]e\s+(?:these|such|those|the|this|its)\s+rights?\b/i,
      /\bwith\s+the\s+right\s+to\s+(?:grant|transfer)\s+(?:\w+\s+){0,2}?(?:sub-?licen[cs]es|those\s+rights)/i,
    ],
    requires: [CONTENT],
    negations: [/\bnon-?sub-?licen[cs]e?able\b/i, /\bnot\s+(?:be\s+)?sub-?licen[cs]/i, NOT_VERB('sublicense|sub-license')],
  },
  {
    categoryId: 'broad_content_license',
    reasonCode: 'ai_training',
    explanation: 'Your content can be used to train AI or machine-learning models.',
    triggers: [
      /\b(?:train|training|improve|develop|fine-?tune)\b[^.;]{0,80}\b(?:machine[- ]learning|artificial\s+intelligence|AI|models?|algorithms|large\s+language)\b/i,
      /\b(?:machine[- ]learning|AI|artificial\s+intelligence)\s+(?:model\s+)?training\b/i,
    ],
    // Training alone is not a licence finding: require content and rights context.
    requires: [CONTENT, LICENCE],
    negations: [NOT_VERB('use|train'), NEVER_VERB('use|train')],
  },
];

const LOOSE: Readonly<Record<CategoryId, RegExp>> = {
  arbitration: /\barbitrat\w*|\bclass action\b|\bjury\b/i,
  unilateral_change: /\bmodif\w*|\bamend\w*|\bchange (?:these|this|the) terms\b/i,
  liability_cap: /\bliab\w*/i,
  data_sale_or_share: /\bsell\b|\bsold\b|\bshare\w*|\bdisclos\w*/i,
  auto_renewal: /\brenew\w*|\brecurring\b/i,
  broad_content_license: /\blicen[cs]\w*/i,
};

/** Clause boundaries inside a sentence for negation scope. */
const CLAUSE_BREAK = /;|,\s*(?:but|however|although|though|whereas|except|unless|while)\b|\s+but\s+|\s+however,?\s+|\s+except\s+(?:that\s+)?/gi;

function clauses(sentence: string): Interval[] {
  const spans: Interval[] = [];
  let start = 0;
  CLAUSE_BREAK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLAUSE_BREAK.exec(sentence)) !== null) {
    if (match[0].length === 0) {
      CLAUSE_BREAK.lastIndex += 1;
      continue;
    }
    spans.push({ start, end: match.index });
    start = match.index + match[0].length;
  }
  spans.push({ start, end: sentence.length });
  return spans.filter((span) => span.end > span.start);
}

function clauseAt(spans: readonly Interval[], offset: number): Interval | null {
  return spans.find((span) => span.start <= offset && offset < span.end) ?? null;
}

/** Trigger hits whose own clause carries no reason-specific negation. Returns the clause spans. */
function positiveClauses(rule: Rule, sentence: string): Interval[] {
  if (rule.requires && !rule.requires.every((pattern) => pattern.test(sentence))) return [];
  const parts = clauses(sentence);
  const hits: Interval[] = [];
  for (const trigger of rule.triggers) {
    const global = new RegExp(trigger.source, trigger.flags.includes('g') ? trigger.flags : `${trigger.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = global.exec(sentence)) !== null) {
      if (match[0].length === 0) {
        global.lastIndex += 1;
        continue;
      }
      const clause = clauseAt(parts, match.index);
      if (!clause) continue;
      const clauseText = sentence.slice(clause.start, clause.end);
      if (rule.negations?.some((pattern) => pattern.test(clauseText))) continue;
      if (!hits.some((item) => item.start === clause.start)) hits.push(clause);
    }
  }
  return hits;
}

function trimmed(text: string, span: Interval): Interval {
  let { start, end } = span;
  while (start < end && /\s/.test(text[start] as string)) start += 1;
  while (end > start && /\s/.test(text[end - 1] as string)) end -= 1;
  return { start, end };
}

function evidenceSpan(text: string, sentence: Interval, clause: Interval): Interval | null {
  if (sentence.end - sentence.start <= LIMITS.maxEvidence) return sentence;
  const span = trimmed(text, { start: sentence.start + clause.start, end: sentence.start + clause.end });
  return span.end - span.start <= LIMITS.maxEvidence && span.end > span.start ? span : null;
}

function wanted(categoryIds: readonly CategoryId[] | undefined): Set<CategoryId> {
  return new Set(categoryIds ?? CATEGORY_IDS);
}

/** Strict reason-scoped rules over the whole captured text. */
export function scanStrict(text: string, categoryIds?: readonly CategoryId[]): Candidate[] {
  const enabled = wanted(categoryIds);
  const candidates: Candidate[] = [];
  for (const sentence of segmentSentences(text)) {
    const sentenceText = text.slice(sentence.start, sentence.end);
    for (const rule of RULES) {
      if (!enabled.has(rule.categoryId)) continue;
      const seen = new Set<string>();
      for (const clause of positiveClauses(rule, sentenceText)) {
        const span = evidenceSpan(text, sentence, clause);
        if (!span) continue;
        const key = `${span.start}-${span.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          categoryId: rule.categoryId,
          reasonCode: rule.reasonCode,
          quote: text.slice(span.start, span.end),
          explanation: rule.explanation,
          start: span.start,
          end: span.end,
          engine: 'rules',
          engineVersion: RULES_VERSION,
        });
      }
    }
  }
  return candidates;
}

/** Loose keyword baseline (evaluation only). No negation handling by design. */
export function scanLoose(text: string, categoryIds?: readonly CategoryId[]): Candidate[] {
  const enabled = wanted(categoryIds);
  const candidates: Candidate[] = [];
  for (const sentence of segmentSentences(text)) {
    if (sentence.end - sentence.start > LIMITS.maxEvidence) continue;
    const sentenceText = text.slice(sentence.start, sentence.end);
    for (const categoryId of CATEGORY_IDS) {
      if (!enabled.has(categoryId) || !LOOSE[categoryId].test(sentenceText)) continue;
      candidates.push({
        categoryId,
        reasonCode: 'unspecified',
        quote: sentenceText,
        explanation: 'Keyword baseline match (evaluation only).',
        start: sentence.start,
        end: sentence.end,
        engine: 'loose',
        engineVersion: LOOSE_VERSION,
      });
    }
  }
  return candidates;
}

/** Historical entry point kept for existing callers. */
export function detectBaseline(text: string, mode: 'strict' | 'loose'): Candidate[] {
  return mode === 'strict' ? scanStrict(text) : scanLoose(text);
}

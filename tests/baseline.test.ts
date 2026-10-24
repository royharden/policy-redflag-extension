import { describe, expect, it } from 'vitest';
import { scanLoose, scanStrict } from '../src/core/baseline';
import { ACME_TERMS_TEXT, CORPUS } from '../src/core/fixtures';
import { CATEGORY_IDS, type ReasonCode } from '../src/core/types';

function reasons(text: string): ReasonCode[] {
  return scanStrict(text).map((item) => item.reasonCode as ReasonCode);
}

function fixture(id: string) {
  const found = CORPUS.find((item) => item.id === id);
  if (!found) throw new Error(`missing fixture ${id}`);
  return found.text;
}

describe('strict rules: plan examples (PLAN.md section 2)', () => {
  it('handles conditional and mixed negation per reason and clause', () => {
    expect(reasons('If you do not cancel, your plan automatically renews.')).toContain('auto_renews');
    expect(reasons('If you do not cancel before renewal, your plan automatically renews.')).toContain('auto_renews');
    expect(reasons('Your plan will not automatically renew.')).toEqual([]);
    const mixed = reasons('We do not sell your data, but may share it with partners.');
    expect(mixed).not.toContain('sale');
    expect(mixed).toContain('sharing_third_party');
    expect(reasons('Disputes will not be heard in court and will be resolved by binding arbitration.')).toContain('binding_arbitration');
    expect(reasons('In no event shall we be liable for indirect damages.')).toContain('exclusion_of_damages');
  });

  it('treats bare warranty, cookie, retention and password-sharing notices as negatives', () => {
    expect(reasons('THE SERVICE IS PROVIDED AS IS AND WITHOUT WARRANTY OF ANY KIND.')).toEqual([]);
    expect(reasons('We use cookies to remember your preferences.')).toEqual([]);
    expect(reasons('We retain your personal information for as long as your account is open.')).toEqual([]);
    expect(reasons('Do not share your password with anyone.')).toEqual([]);
    expect(reasons('By using the service you agree to these terms.')).toEqual([]);
  });

  it('emits the containing sentence, not the trigger word', () => {
    const text = 'Intro.\nYour subscription will automatically renew until you cancel.';
    const [candidate] = scanStrict(text);
    expect(candidate?.quote).toBe('Your subscription will automatically renew until you cancel.');
    expect(text.slice(candidate!.start as number, candidate!.end as number)).toBe(candidate?.quote);
  });

  it('covers every reason code with a positive example', () => {
    const positives: Record<string, string> = {
      auto_renews: 'Your membership renews automatically each year.',
      price_change_on_renewal: 'Your plan renews at the then-current price.',
      cancel_hurdle: 'You may cancel your subscription only by calling our support line.',
      binding_arbitration: 'All claims will be resolved exclusively through arbitration.',
      class_action_waiver: 'You may not bring a class action against us.',
      jury_waiver: 'You waive your right to a trial by jury.',
      modify_any_time: 'We may change these terms from time to time.',
      notice_by_posting: 'Changes are effective upon posting to this page.',
      sale: 'We may sell your personal information to sponsors.',
      sharing_third_party: 'We may share your personal information with third parties.',
      sharing_advertising: 'We share your personal data with advertising networks.',
      damages_cap: 'Our total liability shall not exceed one hundred dollars.',
      exclusion_of_damages: 'We are not liable for any indirect or consequential damages.',
      perpetual_irrevocable: 'You grant us a perpetual license to the content you post.',
      sublicensable: 'You grant us a sublicensable license to your photos.',
      ai_training: 'You license us to use your posts to train our AI models.',
    };
    for (const [reason, sentence] of Object.entries(positives)) {
      expect(reasons(sentence), reason).toContain(reason);
    }
  });

  it('covers named negatives for each category', () => {
    for (const sentence of [
      'We will never sell your personal information.',
      'We do not share your personal information with third parties.',
      'We do not require binding arbitration.',
      'This section does not waive your right to a jury trial.',
      'We will not change these terms without your consent.',
      'Our liability is not limited to the price of a sticker.',
      'You grant us a non-sublicensable, revocable license to your posts.',
      'We do not use your content to train AI models.',
      'Gift plans will not automatically renew.',
      'You can continue using the service by posting new content.',
    ]) {
      expect(reasons(sentence), sentence).toEqual([]);
    }
  });

  it('flags all six categories on the ACME and Northwind fixtures', () => {
    const acme = new Set(scanStrict(ACME_TERMS_TEXT).map((item) => item.categoryId));
    expect([...acme].sort()).toEqual([...CATEGORY_IDS].sort());
    const northwind = new Set(scanStrict(fixture('member-box')).map((item) => item.categoryId));
    expect([...northwind].sort()).toEqual([...CATEGORY_IDS].sort());
    expect(scanStrict(fixture('near-miss'))).toEqual([]);
  });

  it('keeps the loose baseline separate and uncapped', () => {
    expect(scanStrict(fixture('loose-bulletin'))).toEqual([]);
    expect(scanLoose(fixture('loose-bulletin')).length).toBeGreaterThanOrEqual(4);
    const many = Array.from({ length: 10 }, (_, index) => `Plan ${index} renews automatically each month.`).join('\n');
    expect(scanStrict(many)).toHaveLength(10);
  });
});

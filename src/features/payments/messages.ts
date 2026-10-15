import type { PayDetailsError } from '@/db/repositories/memberPayDetails';
import type { PayMethodError, PayMethodKind } from '@/domain/payMethods';
import { describeMemberUpiError } from '@/features/upi/messages';

import type { IconName } from '@/ui/Icon';

export function describePayMethodError(error: PayMethodError): string {
  switch (error) {
    case 'LINK_INVALID':
      return 'Paste the full link, like https://paypal.me/yourname.';
    case 'IBAN_INVALID':
      return 'That IBAN isn’t valid. Check for a typo.';
    case 'BIC_INVALID':
      return 'A BIC has 8 or 11 letters and numbers. Or leave it blank.';
    case 'NAME_REQUIRED':
      return 'Enter the account holder’s name.';
    case 'TEXT_REQUIRED':
      return 'Enter the bank details.';
    case 'TOO_LONG':
      return 'That’s too long.';
    case 'PIX_KEY_INVALID':
      return 'Enter a CPF, CNPJ, +55 phone, email or random Pix key.';
    case 'PAYNOW_INVALID':
      return 'Enter a Singapore mobile number or a UEN.';
    case 'PROMPTPAY_INVALID':
      return 'Enter a Thai mobile number or 13-digit ID.';
  }
}

export function describePayDetailsError(error: PayDetailsError, memberName: string): string {
  if (error.code === 'TOO_MANY_METHODS') return `Up to ${error.max} ways to get paid.`;
  if (error.code === 'NOT_ALLOWED') return `Only ${memberName} can change their payment details.`;
  return describeMemberUpiError(error, memberName);
}

/** The "Add a way to get paid" choices, in the order most people need them. */
export const METHOD_CHOICES: readonly { kind: PayMethodKind; title: string; detail: string; icon: IconName }[] = [
  { kind: 'link', title: 'Payment link', detail: 'PayPal, Revolut, Wise, Venmo…', icon: 'link' },
  { kind: 'iban', title: 'Bank transfer (IBAN)', detail: 'Europe, UK, UAE…', icon: 'bank' },
  { kind: 'pix', title: 'Pix', detail: 'Brazil', icon: 'qr' },
  { kind: 'paynow', title: 'PayNow', detail: 'Singapore', icon: 'qr' },
  { kind: 'promptpay', title: 'PromptPay', detail: 'Thailand', icon: 'qr' },
  { kind: 'bank', title: 'Other bank details', detail: 'Account number, routing…', icon: 'bank' },
];

export const iconForKind = (kind: PayMethodKind): IconName =>
  METHOD_CHOICES.find((c) => c.kind === kind)?.icon ?? 'wallet';

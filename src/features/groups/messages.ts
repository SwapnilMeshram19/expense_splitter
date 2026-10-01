import type { GroupError } from '@/db/repositories/groups';
import type { NameError } from '@/db/repositories/names';

export function describeNameError(error: NameError, subject: string): string {
  switch (error.code) {
    case 'NAME_REQUIRED':
      return `${subject} is required.`;
    case 'NAME_TOO_LONG':
      return `${subject} can be at most ${error.max} characters.`;
    case 'DUPLICATE_NAME':
      return `"${error.name}" appears twice. Use distinct names.`;
  }
}

export function describeGroupError(error: GroupError): string {
  return describeNameError(error.error, error.target === 'group' ? 'Group name' : 'Each name');
}
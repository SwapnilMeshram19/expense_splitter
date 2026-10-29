/**
 * Browser version of src/lib/newId.ts (swapped in by the `@/lib/newId` alias): same UUIDv7, with
 * randomness from Web Crypto instead of expo-crypto.
 */
import { uuidv7 } from '@/lib/id';

const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

export const newId = (): string => uuidv7(randomBytes);

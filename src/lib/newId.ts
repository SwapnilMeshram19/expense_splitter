import { getRandomBytes } from 'expo-crypto';

import { uuidv7 } from './id';

export const newId = (): string => uuidv7(getRandomBytes);
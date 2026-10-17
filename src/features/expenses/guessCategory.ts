import type { ExpenseCategory } from '@/db/schema';

/**
 * Built-in category for a description, from common Indian merchants and words ("Swiggy",
 * "Ola to airport", "chai", "electricity bill"). Null when nothing matches.
 *
 * Only a suggestion: the form applies it while the user hasn't picked a category themselves.
 * Whole words only, so "auto" matches "Auto to station" but not "automatic".
 */
const KEYWORDS: readonly [ExpenseCategory, readonly string[]][] = [
  // Order matters only when one description matches two lists: earlier wins.
  ['groceries', [
    'grocery', 'groceries', 'blinkit', 'zepto', 'bigbasket', 'instamart', 'dmart', 'd-mart', 'jiomart',
    'kirana', 'vegetables', 'veggies', 'sabzi', 'sabji', 'fruits', 'milk', 'doodh', 'ration', 'supermarket',
  ]],
  ['food', [
    'food', 'swiggy', 'zomato', 'breakfast', 'lunch', 'dinner', 'brunch', 'snacks', 'nashta', 'khana',
    'chai', 'tea', 'coffee', 'cafe', 'restaurant', 'dhaba', 'pizza', 'burger', 'biryani', 'dosa', 'thali',
    'icecream', 'ice cream', 'drinks', 'beer', 'bar', 'pub', 'cake', 'sweets', 'mithai', 'treat',
  ]],
  ['travel', [
    'flight', 'flights', 'airfare', 'train', 'irctc', 'tatkal', 'railway', 'bus ticket', 'volvo', 'redbus',
    'makemytrip', 'goibibo', 'cleartrip', 'ixigo', 'visa', 'trip', 'tour', 'sightseeing', 'ferry', 'cruise',
  ]],
  ['transport', [
    'uber', 'ola', 'rapido', 'auto', 'rickshaw', 'cab', 'taxi', 'metro', 'local train', 'petrol', 'diesel',
    'fuel', 'cng', 'toll', 'fastag', 'parking', 'bike rent', 'car rent', 'scooty',
  ]],
  ['stay', [
    'hotel', 'oyo', 'airbnb', 'hostel', 'homestay', 'resort', 'room', 'stay', 'lodge', 'guest house', 'pg',
  ]],
  ['utilities', [
    'electricity', 'light bill', 'bescom', 'msedcl', 'wifi', 'wi-fi', 'internet', 'broadband', 'jio fiber',
    'airtel', 'recharge', 'mobile bill', 'dth', 'gas', 'cylinder', 'water bill', 'maintenance', 'maid',
    'cook', 'society', 'bill',
  ]],
  ['shopping', [
    'amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'shopping', 'clothes', 'shoes', 'gift',
    'gifts', 'decathlon', 'mall',
  ]],
  ['entertainment', [
    'movie', 'movies', 'film', 'pvr', 'inox', 'bookmyshow', 'netflix', 'hotstar', 'prime', 'spotify',
    'concert', 'party', 'bowling', 'gaming', 'match', 'tickets', 'club', 'game',
  ]],
];

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PATTERNS: readonly [ExpenseCategory, RegExp][] = KEYWORDS.map(([category, words]) => [
  category,
  // Explicit boundaries (no lookbehind or \p{…}: kept to regex features every Hermes build has).
  new RegExp(`(?:^|[^a-z0-9])(?:${words.map(escape).join('|')})(?=$|[^a-z0-9])`, 'i'),
]);

export function guessCategory(description: string): ExpenseCategory | null {
  const text = description.trim();
  if (text.length < 2) return null;
  for (const [category, pattern] of PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return null;
}

import { groupIntoRows, parseAmountToken, parseReceipt, type OcrLine } from '../parseReceipt';

/** A line on visual row `row`; `left` puts it in a column; `dy` simulates skew. */
const L = (text: string, row: number, left = 0, dy = 0): OcrLine => ({
  text,
  left,
  top: row * 30 + dy,
  width: 100,
  height: 20,
});

describe('parseAmountToken', () => {
  it.each<[string, number]>([
    ['180.00', 18000],
    ['1,250.00', 125000],
    ['1,25,000', 12500000],
    ['1,250,000.50', 125000050],
    ['Rs.250', 25000],
    ['₹99.5', 9950],
    ['250/-', 25000],
    ['25O.00', 25000],
    ['250,50', 25050],
    ['-58.00', -5800],
    ['(58.00)', -5800],
    ['+1.00', 100],
  ])('%p → %p paise', (token, paise) => {
    expect(parseAmountToken(token)).toBe(paise);
  });

  it.each(['0.00', '12:30', '2.5%', '9876543210', '06/10/2026', 'abc', '₹', '1.'])('rejects %p', (token) => {
    expect(parseAmountToken(token)).toBeNull();
  });
});

describe('groupIntoRows', () => {
  it('puts a separate price column back on its item rows, tolerating slight skew', () => {
    expect(
      groupIntoRows([L('Tea', 1), L('20.00', 1, 300, 8), L('Coffee', 2), L('40.00', 2, 300, -7)]),
    ).toEqual(['Tea 20.00', 'Coffee 40.00']);
  });
});

describe('parseReceipt', () => {
  it('reads a typical restaurant bill', () => {
    const lines = [
      L('Hotel Saffron', 0),
      L('GSTIN 27ABCDE1234F1Z5', 1),
      L('Bill No: 1234', 2),
      L('Date: 06/10/2026', 2, 300),
      L('Item Qty Rate Amount', 3),
      L('Paneer Tikka', 4),
      L('2 180.00 360.00', 4, 300),
      L('Butter Naan', 5),
      L('4 40.00 160.00', 5, 300),
      L('Masala Chaas', 6),
      L('60.00', 6, 300),
      L('Sub Total', 7),
      L('580.00', 7, 300),
      L('CGST 2.5%', 8),
      L('14.50', 8, 300),
      L('SGST 2.5%', 9),
      L('14.50', 9, 300),
      L('Round Off', 10),
      L('+1.00', 10, 300),
      L('Grand Total', 11),
      L('₹610.00', 11, 300),
      L('Cash 1000.00', 12),
      L('Thank you visit again', 13),
    ];
    expect(parseReceipt(lines)).toEqual({
      merchant: 'Hotel Saffron',
      items: [
        { name: 'Paneer Tikka', amountPaise: 36000, quantity: 2 },
        { name: 'Butter Naan', amountPaise: 16000, quantity: 4 },
        { name: 'Masala Chaas', amountPaise: 6000, quantity: null },
      ],
      charges: [
        { label: 'CGST 2.5%', amountPaise: 1450 },
        { label: 'SGST 2.5%', amountPaise: 1450 },
        { label: 'Round Off', amountPaise: 100 },
      ],
      subtotalPaise: 58000,
      totalPaise: 61000,
    });
  });

  it('joins an item name wrapped over two lines', () => {
    const result = parseReceipt([
      L('Biryani House', 0),
      L('Chicken Biryani', 1),
      L('Family Pack', 2),
      L('450.00', 3, 300),
      L('Total', 4),
      L('450.00', 4, 300),
    ]);
    expect(result.items).toEqual([{ name: 'Chicken Biryani Family Pack', amountPaise: 45000, quantity: null }]);
    expect(result.totalPaise).toBe(45000);
  });

  it('treats a plain "Total" followed by tax lines as the sub-total', () => {
    const result = parseReceipt([L('Cafe', 0), L('Tea 20.00', 1), L('Total 20.00', 2), L('GST 5% 1.00', 3)]);
    expect(result.subtotalPaise).toBe(2000);
    expect(result.totalPaise).toBeNull();
    expect(result.charges).toEqual([{ label: 'GST 5%', amountPaise: 100 }]);
  });

  it('skips address lines and PIN codes, reads leading quantities and discounts', () => {
    const result = parseReceipt([
      L('Cafe Blue', 0),
      L('MG Road, Sector 5', 1),
      L('Pune 411001', 2),
      L('2 Masala Dosa 240.00', 3),
      L('Filter Coffee 60.00', 4),
      L('Discount 10%', 5),
      L('30.00', 5, 300),
    ]);
    expect(result).toEqual({
      merchant: 'Cafe Blue',
      items: [
        { name: 'Masala Dosa', amountPaise: 24000, quantity: 2 },
        { name: 'Filter Coffee', amountPaise: 6000, quantity: null },
      ],
      charges: [{ label: 'Discount 10%', amountPaise: -3000 }],
      subtotalPaise: null,
      totalPaise: null,
    });
  });

  it('returns an empty result for no text', () => {
    expect(parseReceipt([])).toEqual({ merchant: null, items: [], charges: [], subtotalPaise: null, totalPaise: null });
  });
});
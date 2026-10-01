export const SHOP_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'INR'];

// Human-readable post text keeps listings compatible with the existing post
// storage, moderation, exports, and connected-account publishing pipeline.
export function formatShopPost({ title, price, currency, description }) {
  const name = String(title || '').trim();
  const amount = String(price ?? '').trim();
  const body = String(description || '').trim();
  if (!name || name.length > 120 || /[\r\n]/.test(name)) throw new Error('Enter an item title of up to 120 characters.');
  if (!SHOP_CURRENCIES.includes(currency) || !/^\d{1,8}(?:\.\d{1,2})?$/.test(amount)) throw new Error('Enter a valid price with up to two decimal places.');
  if (!body) throw new Error('Add a description of your item.');
  const content = `Item: ${name}\nPrice: ${currency} ${Number(amount).toFixed(2)}\n\n${body}`;
  if (content.length > 2000) throw new Error('Shorten the description so the complete listing fits within 2,000 characters.');
  return content;
}

export function readShopPost(content) {
  const text = typeof content === 'string' ? content : '';
  const match = text.match(/^Item: ([^\r\n]{1,120})\r?\nPrice: ([A-Z]{3}) (\d{1,8}\.\d{2})\r?\n\r?\n([\s\S]*)$/);
  if (!match || !SHOP_CURRENCIES.includes(match[2])) return { title: 'Shop post', price: null, description: text };
  return { title: match[1], price: Number(match[3]), currency: match[2], description: match[4] };
}

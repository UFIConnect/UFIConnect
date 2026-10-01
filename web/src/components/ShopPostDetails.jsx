import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { readShopPost } from '../utils/shopPost.mjs';
import './ShopPosts.css';

export default function ShopPostDetails({ post }) {
  const [expanded, setExpanded] = useState(false);
  const item = readShopPost(post.content);
  const price = item.price === null ? 'Price not listed' : new Intl.NumberFormat(undefined, { style: 'currency', currency: item.currency, currencyDisplay: 'code' }).format(item.price);
  const long = item.description.length > 260;
  return <section className="shop-post-details" aria-label="Item details">
    <div className="shop-post-heading"><div><span className="shop-post-label"><ShoppingBag size={13} aria-hidden="true" />Shop</span><h3>{item.title}</h3></div><strong className="shop-post-price">{price}</strong></div>
    <h4>Description</h4>
    <p>{long && !expanded ? item.description.slice(0, 260).trimEnd() + '…' : item.description || 'The seller has not added a description.'}</p>
    {long && <button className="shop-description-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : 'Read more'}</button>}
  </section>;
}

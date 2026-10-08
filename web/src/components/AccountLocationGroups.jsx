import { accountLocalSourceLabel } from '../../../shared/accountLocation.js';

export default function AccountLocationGroups({ section, headingLevel = 3, children }) {
  if (!section.groups) return section.items.map(children);
  const Heading = `h${headingLevel}`;
  return section.groups.map(group => <div key={group.id} className="account-location-group" role="group" aria-label={group.label}>
    <Heading className="account-location-group-heading">{group.label}</Heading>
    {!group.items.length && <p className="account-location-empty">{group.emptyMessage}</p>}
    {group.items.map(item => {
      const label = group.id === 'local' ? accountLocalSourceLabel(item[1]) : '';
      return <div key={item[0]} className="account-location-entry">
        {label && <p className="account-location-source-area">{label}</p>}
        {children(item)}
      </div>;
    })}
  </div>);
}

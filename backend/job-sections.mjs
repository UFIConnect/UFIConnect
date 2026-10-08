// Shared by importers and the browser so source headings survive normalization.
const headingKinds = [
  ['tasks', /^(?:(?:(?:your|the) )?(?:(?:key|main|primary|essential|core|job|major|position|day.to.day|daily) )?(?:responsibilities(?: and duties)?|duties(?: and responsibilities)?|role tasks|tasks|accountabilities|job functions|functions)|what you(?:['’]ll| will)? do|what you(?:['’]ll| will) be doing|what you do|you(?:['’]ll| will)|your (?:impact|mission|day.to.day)|a (?:typical )?day in (?:the|your) (?:life|role))$/i],
  ['requirements', /^(?:(?:(?:minimum|preferred|required|basic|essential|desired|key) )?(?:qualifications(?: and (?:skills|experience))?|requirements|skills(?: and (?:experience|qualifications))?|experience|education|certifications)|(?:job|position) requirements|what you(?:['’]ll| will) (?:bring|need)|what we(?:['’]re| are) looking for|who you are|about you|your (?:profile|background)|what (?:it takes|you need)|knowledge,? skills(?: and abilities)?)$/i],
  ['company', /^(?:about us|about (?:the|our) (?:company|organization|team)|company (?:description|overview)|who we are|our (?:company|team|mission|values)|why (?:us|join us))$/i],
  ['benefits', /^(?:benefits(?: and perks)?|perks(?: and benefits)?|what we offer|(?:salary|pay)(?: and benefits)?|(?:salary and |pay and )?compensation|rewards|what(?:['’]s| is) in it for you|why work (?:here|with us))$/i],
  ['other', /^(?:how to apply|apply|application (?:process|instructions)|equal opportunity(?: employer)?|additional (?:information|details)|disclaimer|accommodations|(?:conditions of |employment |work )conditions|conditions of employment|physical demands|work environment|working conditions|travel requirements|location|eligibility|security clearance|required documents|how you will be evaluated|important (?:information|notes))$/i],
  ['role', /^(?:the (?:role|position|opportunity)|about (?:the|this|our) (?:role|position|opportunity)|job (?:description|summary)|position (?:description|summary)|role (?:description|overview|summary)|overview|summary|your role|what you will be part of)$/i],
];
export function careerHeadingKind(value) {
  const heading = value.replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '').replace(/^(?:[-•●▪]|\d+[.)])\s*/, '')
    .replace(/\s*[:–—-]\s*$/, '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*&\s*/g, ' and ')
    .replace(/\s+(?:(?:will )?include|includes|are)(?: the following|,? but (?:are )?not limited to)?$/i, '').trim();
  return headingKinds.find(([, regex]) => regex.test(heading))?.[0] || null;
}

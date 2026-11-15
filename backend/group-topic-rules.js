'use strict';

// Discover Groups categories. The first topic is the destination when the
// category is the only evidence. The others can use it as a subtopic too.
const GROUP_CATEGORY_TOPICS = {
  'AI & ML': ['AI & Machine Learning', 'Generative AI', 'LLMs & Chatbots', 'Data Science', 'Computer Vision'],
  'Career Growth': ['Career Growth', 'Recruiting & Hiring'],
  Climate: ['Sustainability', 'Climate Tech', 'Environmental Science', 'Energy & Utilities'],
  Community: ['Social Media'],
  Design: ['UI/UX Design', 'Design Systems', 'Brand Identity', 'Photography', '3D & CGI', 'Motion Design'],
  Education: ['EdTech', 'Career Growth', 'Productivity', 'Non-Fiction & Learning'],
  Engineering: ['Developer Tools', 'Frontend Dev', 'Backend Dev', 'Mobile Dev', 'Cloud & DevOps', 'Open Source', 'API Design',
    'Python', 'JavaScript', 'TypeScript', 'Go', 'Rust', 'React', 'Node', 'Cybersecurity', 'Database', 'Linux', 'Docker & Containers', 'Kubernetes', 'Robotics'],
  Fashion: ['Fashion', 'Streetwear', 'Sustainable Fashion', 'Beauty & Skincare'],
  Finance: ['Personal Finance', 'FinTech', 'Corporate Finance', 'Web3 / Crypto', 'Accounting & Tax'],
  Food: ['Food & Drink', 'Cooking & Recipes', 'Culinary Arts', 'Restaurant Culture', 'Baking & Pastry', 'Coffee Culture', 'Wine & Spirits'],
  Gaming: ['Gaming', 'Video Games', 'Game Dev', 'Mobile Gaming', 'Esports & Competitive Gaming', 'Tabletop & Board Games'],
  Health: ['Wellness', 'Health Tech', 'Mental Health', 'Fitness & Gym', 'Nutrition & Diet', 'Public Health', 'Medicine & Clinical Practice'],
  Lifestyle: ['Wellness', 'Home & Garden', 'Gardening & Plants', 'Interior Design & Decor', 'Pets & Animals', 'Books', 'Parenting & Family', 'Photography'],
  Marketing: ['Marketing', 'Growth Marketing', 'SEO & Content', 'Brand Strategy', 'Creator Economy'],
  Marketplace: ['Marketplaces', 'E-commerce'],
  Music: ['Music Discovery', 'Music Production', 'Music Industry', 'Songwriting', 'Live Events & Concerts', 'DJing & Remixing'],
  'Remote Work': ['Remote Work', 'Digital Nomad', 'Freelancing', 'Future of Work'],
  Space: ['Science & Research', 'SpaceTech', 'Aviation & Aerospace'],
  Sports: ['Sports', 'Football & Soccer', 'Basketball', 'Tennis & Golf', 'Combat Sports', 'Running & Cycling', 'Sports Analytics'],
  Startups: ['Startup', 'Startups', 'SaaS', 'Product Management', 'Side Projects', 'Venture Capital', 'Fundraising'],
  Travel: ['Travel & Adventure', 'Cultural Tourism', 'Budget Travel', 'Solo Travel', 'Digital Nomad'],
};

// Subjects that show up as group names, source labels or post text. Keep
// destinations in the feed catalog so the same label works for transfer.
const RELATED_SUBTOPICS = {
  'Science & Research': { Astronomy: ['astronomy', 'astrophysics', 'stargazing', 'astronomical observations'] },
  SpaceTech: { Spaceflight: ['spaceflight', 'spacex', 'space launch', 'rocket launch', 'satellite mission', 'space exploration'] },
  Sports: {
    Baseball: ['baseball', 'mlb'],
    Motorsport: ['motorsport', 'motor racing', 'formula 1', 'formula1', 'nascar', 'indycar'],
    Swimming: ['swimming', 'swim meet', 'open water swimming'],
  },
  'Football & Soccer': { Leagues: ['premier league', 'premierleague', 'champions league', 'major league soccer', 'bundesliga', 'la liga'] },
  'Mobile Dev': {
    'Android development': ['androiddev', 'android development', 'jetpack compose', 'android sdk'],
    'Apple development': ['swift', 'swiftui', 'ios development'],
  },
  'Cloud & DevOps': { 'Cloud providers': ['amazon web services', 'aws', 'microsoft azure', 'google cloud'] },
  'Developer Tools': { 'Programming': ['programming', 'learnprogramming', 'software development'] },
  'Frontend Dev': { 'Web development': ['webdev', 'web development', 'css layout'] },
  'UI/UX Design': { 'Graphic design': ['graphic design', 'graphicdesign', 'graphic_design'] },
  '3D & CGI': { '3D modelling': ['blender', '3d modeling', '3d modelling', '3d rendering'] },
  'Personal Finance': {
    'Budgeting': ['frugal', 'frugal living', 'financial independence', 'leanfire'],
    'Investing': ['stock investing', 'stock market', 'investing', 'index funds'],
  },
  'Gardening & Plants': { Houseplants: ['houseplant', 'houseplants', 'indoor gardening'] },
  'Home Improvement': { Woodworking: ['woodworking', 'carpentry projects'] },
  'Music Discovery': { 'Music genres': ['jazz', 'hip hop', 'classical music', 'indie music'] },
  'Food & Drink': { 'Food culture': ['street food', 'food culture', 'food festivals'] },
  'Coffee Culture': { 'Coffee brewing': ['espresso', 'pour over coffee', 'coffee brewing'] },
  'Travel & Adventure': { 'Road trips': ['road trip', 'road trips', 'vanlife', 'van life'] },
  'Art & Painting': { Illustration: ['illustration', 'digital illustration', 'sketching'], 'Visual arts': ['visual arts'] },
  Photography: { 'Film photography': ['film photography', 'analog photography', 'photographic film'] },
  'Video Games': { 'PC gaming': ['pc gaming', 'pcgaming', 'pc gaming hardware'] },
  'Tabletop & Board Games': { 'Tabletop role-playing': ['tabletop role playing', 'tabletop rpg', 'dungeons and dragons'] },
  'Climate Tech': { 'Clean technology': ['cleantech', 'clean technology', 'solar technology'] },
  'Energy & Utilities': { 'Renewable power': ['renewable power', 'solar power', 'wind power'] },
  'Parenting & Family': { 'Family activities': ['family activities', 'family outings'] },
  'Open Source': { 'Open-source projects': ['open source project', 'open source projects', 'opensource'] },
};

module.exports = { GROUP_CATEGORY_TOPICS, RELATED_SUBTOPICS };

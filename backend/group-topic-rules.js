'use strict';

// Broad Discover categories remain available for existing manual decisions.
// Automatic routing uses the subject rules below.
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
  'Science & Research': {
    Astronomy: ['astrophysics', 'stargazing', 'astronomical observations', 'astrophotography', 'astronomía', 'astronomie', 'astrofotografía'],
    'Science discussion': ['askscience', 'science questions', 'scientific discussion'],
  },
  SpaceTech: { Spaceflight: ['spacex', 'spacexlounge', 'nasa', 'space launch', 'rocket launch', 'satellite mission', 'space exploration', 'vuelo espacial'] },
  Sports: {
    Baseball: ['mlb', 'béisbol'],
    Motorsport: ['motor racing', 'formula 1', 'formula1', 'nascar', 'indycar', 'automovilismo', 'sport automobile'],
    Swimming: ['swim meet', 'open water swimming', 'natación', 'natation'],
  },
  'Football & Soccer': { Leagues: ['premier league', 'premierleague', 'champions league', 'major league soccer', 'bundesliga', 'la liga'] },
  'Mobile Dev': {
    'Android development': ['androiddev', 'android development', 'jetpack compose', 'android sdk'],
    'Apple development': ['swift', 'swiftui', 'ios development'],
  },
  'Cloud & DevOps': {
    'Cloud providers': ['amazon web services', 'aws', 'microsoft azure', 'google cloud'],
    'Self-hosting': ['self hosted', 'selfhosted', 'home lab', 'homelab', 'autoalojamiento', 'auto-hébergement'],
    'Systems administration': ['system administration', 'sysadmin'],
  },
  Cybersecurity: { 'Network security': ['netsec', 'seguridad de redes', 'sécurité des réseaux'] },
  'LLMs & Chatbots': { 'Local models': ['localllama', 'local llama', 'local llm', 'locally hosted llm'] },
  'Generative AI': { 'Image generation': ['stablediffusion', 'stable diffusion', 'generación de imágenes'] },
  'Developer Tools': { 'Programming': ['programming', 'learnprogramming', 'software development'] },
  'Frontend Dev': { 'Web development': ['webdev', 'web development', 'css layout'] },
  'UI/UX Design': { 'Graphic design': ['graphic design', 'graphicdesign', 'graphic_design'] },
  '3D & CGI': { '3D modelling': ['blender', '3d modeling', '3d modelling', '3d rendering'] },
  'Personal Finance': {
    'Budgeting': ['frugal', 'frugal living', 'financial independence', 'leanfire'],
    'Investing': ['stock investing', 'stock market', 'investing', 'index funds'],
  },
  'Gardening & Plants': { Houseplants: ['houseplant', 'indoor gardening', 'plantas de interior', 'plantes d’intérieur'] },
  'Home Improvement': { Woodworking: ['carpentry projects', 'woodworking projects', 'trabajos de carpintería'] },
  'Music Discovery': { 'Music genres': ['jazz', 'hip hop', 'classical music', 'indie music'] },
  'Food & Drink': { 'Food culture': ['street food', 'food culture', 'food festivals'] },
  'Cooking & Recipes': { 'Meal prep': ['meal preparation', 'mealprepsunday', 'batch cooking', 'preparación de comidas'] },
  'Nutrition & Diet': { 'Plant-based nutrition': ['plantbaseddiet', 'plant based diet', 'plant based nutrition', 'alimentación vegetal'] },
  'Coffee Culture': { 'Coffee brewing': ['espresso', 'pour over coffee', 'coffee brewing'] },
  'Travel & Adventure': { 'Road trips': ['road trip', 'road trips', 'vanlife', 'van life'] },
  'Art & Painting': { Illustration: ['illustration', 'digital illustration', 'sketching'], 'Visual arts': ['visual arts'] },
  Photography: { 'Film photography': ['film photography', 'analog photography', 'photographic film'] },
  Streetwear: { Sneakers: ['sneaker culture', 'sneaker collection'], 'Raw denim': ['rawdenim', 'selvedge denim', 'selvedge jeans'] },
  'Video Games': { 'PC gaming': ['pc gaming', 'pcgaming', 'pc gaming hardware'] },
  'Tabletop & Board Games': {
    'Tabletop role-playing': ['tabletop role playing', 'tabletop rpg', 'dungeons and dragons'],
    Chess: ['chess openings', 'chess puzzles', 'ajedrez', 'partie d’échecs'],
  },
  Sustainability: { Solarpunk: ['solarpunk movement', 'solarpunk design'] },
  'Climate Tech': { 'Clean technology': ['cleantech', 'clean technology', 'solar technology'] },
  'Energy & Utilities': { 'Renewable power': ['renewable power', 'solar power', 'wind power'] },
  'Parenting & Family': { 'Family activities': ['family activities', 'family outings'] },
  'Open Source': { 'Open-source projects': ['open source project', 'open source projects', 'opensource'] },
};

module.exports = { GROUP_CATEGORY_TOPICS, RELATED_SUBTOPICS };

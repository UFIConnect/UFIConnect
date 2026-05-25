const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

const users = [
  {
    id: 'u1',
    name: 'Maria Chen',
    email: 'maria@example.com',
    passwordHash: bcrypt.hashSync('password123', 10),
    title: 'Product Lead',
    skills: ['Community', 'Growth', 'Strategy'],
    organization: 'Future Networks'
  }
];

const groups = [
  {
    id: 'g1',
    name: 'Remote Startup Founders',
    description: 'A group for founders building distributed teams and professional networks.'
  },
  {
    id: 'g2',
    name: 'AI Product Managers',
    description: 'Connect with product builders working on AI, automation, and workflow tools.'
  }
];

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: 'Authorization header missing.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

app.get('/groups', (req, res) => {
  res.json({ groups });
});

app.post('/auth/register', (req, res) => {
  const { name, email, password, title } = req.body;
  if (!name || !email || !password || !title) {
    return res.status(400).json({ message: 'Missing registration fields.' });
  }

  const existingUser = users.find((user) => user.email === email);
  if (existingUser) {
    return res.status(409).json({ message: 'Email already registered.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const newUser = {
    id: `u${users.length + 1}`,
    name,
    email,
    passwordHash,
    title,
    skills: [],
    organization: ''
  };
  users.push(newUser);

  const token = jwt.sign({ id: newUser.id, email: newUser.email }, JWT_SECRET, {
    expiresIn: '7d'
  });

  res.status(201).json({ token, profile: { id: newUser.id, name: newUser.name, email: newUser.email, title: newUser.title } });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find((item) => item.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: '7d'
  });

  res.json({ token, profile: { id: user.id, name: user.name, title: user.title, email: user.email } });
});

app.get('/profile', authenticate, (req, res) => {
  const user = users.find((item) => item.id === req.user.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }
  res.json({ profile: { id: user.id, name: user.name, title: user.title, email: user.email, skills: user.skills, organization: user.organization } });
});

app.listen(PORT, () => {
  console.log(`ProConnect backend listening on http://localhost:${PORT}`);
});

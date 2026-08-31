-- ============================================================
--  UFconnect — PostgreSQL Schema
--  Run once:  psql $DATABASE_URL -f schema.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(100)  NOT NULL,
  email           VARCHAR(255)  UNIQUE NOT NULL,
  phone           VARCHAR(20)   DEFAULT '',
  password_hash   VARCHAR(255)  NOT NULL,
  auth_provider   VARCHAR(50)   DEFAULT 'local',
  auth_subject    VARCHAR(255),
  title           VARCHAR(200),
  bio             TEXT,
  organization    VARCHAR(200),
  skills          TEXT[]        DEFAULT '{}',
  avatar_url      VARCHAR(500),
  onboarding_complete BOOLEAN   DEFAULT FALSE,
  -- onboarding preferences
  role            VARCHAR(100),
  goals           TEXT[]        DEFAULT '{}',
  interests       TEXT[]        DEFAULT '{}',
  experience      VARCHAR(50),
  created_at      TIMESTAMPTZ   DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   DEFAULT NOW()
);

-- ── Groups ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id              VARCHAR(50)   PRIMARY KEY,
  category        VARCHAR(100)  NOT NULL,
  name            VARCHAR(200)  NOT NULL,
  description     TEXT,
  member_count    INTEGER       DEFAULT 0,
  related_groups  TEXT[]        DEFAULT '{}',
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

-- ── User ↔ Group membership ──────────────────────────────────
CREATE TABLE IF NOT EXISTS user_groups (
  user_id         UUID          REFERENCES users(id)  ON DELETE CASCADE,
  group_id        VARCHAR(50)   REFERENCES groups(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ   DEFAULT NOW(),
  PRIMARY KEY (user_id, group_id)
);

-- ── Posts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id              VARCHAR(50)   PRIMARY KEY,
  author_id       UUID          REFERENCES users(id) ON DELETE CASCADE,
  content         TEXT          NOT NULL,
  group_id        VARCHAR(50)   REFERENCES groups(id) ON DELETE SET NULL,
  like_count      INTEGER       DEFAULT 0,
  comment_count   INTEGER       DEFAULT 0,
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

-- ── Post likes ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_likes (
  post_id         VARCHAR(50)   REFERENCES posts(id) ON DELETE CASCADE,
  user_id         UUID          REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ   DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

-- ── Connections ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connections (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id    UUID          REFERENCES users(id) ON DELETE CASCADE,
  target_id       UUID          REFERENCES users(id) ON DELETE CASCADE,
  status          VARCHAR(20)   DEFAULT 'pending',  -- pending | accepted | rejected
  created_at      TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE (requester_id, target_id)
);

-- ── Conversations ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id UUID          REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID          REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, user_id)
);

-- ── Messages ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID          REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID          REFERENCES users(id) ON DELETE CASCADE,
  content         TEXT,
  attachment      JSONB,        -- { name, size, mimeType, uri }
  is_read         BOOLEAN       DEFAULT FALSE,
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

-- ── Social accounts ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_accounts (
  user_id         UUID          REFERENCES users(id) ON DELETE CASCADE,
  platform        VARCHAR(50)   NOT NULL,
  platform_user_id VARCHAR(200),
  access_token    TEXT,
  connected_at    TIMESTAMPTZ   DEFAULT NOW(),
  PRIMARY KEY (user_id, platform)
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_posts_author    ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_group     ON posts(group_id);
CREATE INDEX IF NOT EXISTS idx_posts_created   ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conv   ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at ASC);
CREATE INDEX IF NOT EXISTS idx_conn_requester  ON connections(requester_id);
CREATE INDEX IF NOT EXISTS idx_conn_target     ON connections(target_id);
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_subject
  ON users(auth_provider, auth_subject)
  WHERE auth_subject IS NOT NULL;

-- ── Auto-update updated_at ────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

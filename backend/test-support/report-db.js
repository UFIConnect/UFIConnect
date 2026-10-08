'use strict';
// Local PostgreSQL fixtures use the production target column types so ingestion
// and moderation queries are executed rather than matched by a mock.
const REPORT_TARGET_TEST_SCHEMA = `
  CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,email TEXT,plan TEXT DEFAULT 'free',auth_version INTEGER DEFAULT 0,billing_closed BOOLEAN DEFAULT false);
  CREATE TABLE community_posts(id TEXT PRIMARY KEY,group_id TEXT,author_id TEXT,author_name TEXT,author_title TEXT,title TEXT,content TEXT NOT NULL,url TEXT,source TEXT DEFAULT 'uficonnect',source_label TEXT,likes TEXT[] DEFAULT '{}',comments_count INTEGER DEFAULT 0,created_at TIMESTAMPTZ DEFAULT NOW(),media_url TEXT,media_type TEXT);
  CREATE TABLE post_comments(id TEXT PRIMARY KEY,post_id TEXT NOT NULL,author_id TEXT NOT NULL,content TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE feed_posts_cache(id TEXT PRIMARY KEY,source TEXT NOT NULL,group_id TEXT,title TEXT,content TEXT,author_name TEXT,source_url TEXT,media_url TEXT,media_type TEXT,video_duration_seconds INTEGER,topic TEXT,likes_count INTEGER DEFAULT 0,comments_count INTEGER DEFAULT 0,post_created_at TIMESTAMPTZ,fetched_at TIMESTAMPTZ DEFAULT NOW(),location TEXT,media_poster TEXT,author_avatar_url TEXT,author_profile_url TEXT,source_checked_at TIMESTAMPTZ,source_check_status TEXT,source_check_failures INTEGER DEFAULT 0);
  CREATE TABLE feed_posts_staging(LIKE feed_posts_cache INCLUDING ALL);
  CREATE TABLE feed_posts_archive(LIKE feed_posts_cache INCLUDING ALL);
  CREATE TABLE external_post_likes(post_id TEXT,user_id TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(post_id,user_id));
  CREATE TABLE restaurant_post_likes(LIKE external_post_likes INCLUDING ALL);
  CREATE TABLE seen_posts(user_id TEXT,post_id TEXT,seen_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(user_id,post_id));
`;
const REPORT_BASE_TEST_SCHEMA = `CREATE TABLE reports(id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,reason TEXT NOT NULL,details TEXT,status TEXT NOT NULL DEFAULT 'open',created_at TIMESTAMPTZ DEFAULT NOW(),resolved_at TIMESTAMPTZ,resolved_by TEXT); CREATE TABLE creator_copyright_reports(id UUID PRIMARY KEY,status TEXT NOT NULL);`;
module.exports = { REPORT_TARGET_TEST_SCHEMA, REPORT_BASE_TEST_SCHEMA };

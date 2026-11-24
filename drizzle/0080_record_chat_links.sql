CREATE TABLE record_chat_links (
  chat_id text PRIMARY KEY NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  store_identity text NOT NULL,
  record_path text NOT NULL,
  record_id text NOT NULL,
  canonical_project_id text NOT NULL,
  source_revision text NOT NULL
);

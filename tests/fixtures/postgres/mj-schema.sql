-- Minimal MemberJunction (__mj) schema for regression-test purposes.
--
-- Real MJ has dozens of tables describing entities, fields, relationships,
-- applications, users, audit logs, etc. For the harness we only need
-- enough to exercise:
--
--   • Forge's awareness of the __mj namespace (explorer tree, queries)
--   • The two MJ-specific regression tests from the legacy 31-suite:
--       #22  __mj.entity with a JOIN — 20+ rows expected
--       #23  __mj.application — 10+ rows expected
--
-- Identifiers are lowercase (PG default) so test queries can be written
-- without quoting. The real MJ uses PascalCase on MSSQL but the meaningful
-- thing here is shape + cardinality, not byte-for-byte fidelity.

CREATE SCHEMA IF NOT EXISTS __mj;

CREATE TABLE __mj.user (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE __mj.application (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE __mj.entity (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  base_table      TEXT NOT NULL,
  schema_name     TEXT NOT NULL DEFAULT 'public',
  application_id  INTEGER NOT NULL REFERENCES __mj.application(id),
  owner_user_id   INTEGER NOT NULL REFERENCES __mj.user(id),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (schema_name, base_table)
);

CREATE INDEX entity_application_id_idx ON __mj.entity (application_id);
CREATE INDEX entity_owner_user_id_idx ON __mj.entity (owner_user_id);

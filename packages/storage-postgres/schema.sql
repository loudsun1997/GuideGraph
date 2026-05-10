CREATE TABLE IF NOT EXISTS workflow_instances (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  workflow_version TEXT NOT NULL,
  status TEXT NOT NULL,
  active_step_ids JSONB NOT NULL DEFAULT '[]',
  step_states JSONB NOT NULL DEFAULT '{}',
  context JSONB NOT NULL DEFAULT '{}',
  artifact_ids JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workflow_events (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  step_id TEXT,
  actor_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  idempotency_key TEXT,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_history (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  instance_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  step_id TEXT,
  actor_id TEXT,
  message TEXT NOT NULL,
  before JSONB,
  after JSONB,
  metadata JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_idempotency_results (
  instance_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  event_fingerprint TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (instance_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS workflow_events_instance_id_occurred_at_idx
  ON workflow_events (instance_id, occurred_at, id);

CREATE INDEX IF NOT EXISTS workflow_history_instance_id_occurred_at_idx
  ON workflow_history (instance_id, occurred_at, id);

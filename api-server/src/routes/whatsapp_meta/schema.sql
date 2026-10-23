-- Private provider transport storage. Not an ERP projection or financial ledger.
-- Installed only by the explicit whatsapp-inbox-worker --migrate command.
CREATE TABLE lumiere_whatsapp.inbox (
    id bigserial PRIMARY KEY,
    organization_id text NOT NULL,
    account_id text NOT NULL,
    company_id text,
    event_key text NOT NULL CHECK (length(event_key) = 64),
    fingerprint text NOT NULL CHECK (length(fingerprint) = 64),
    event_json text NOT NULL CHECK (octet_length(event_json) <= 1048576),
    state text NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'processing', 'retry', 'processed', 'quarantined')),
    attempts integer NOT NULL DEFAULT 0,
    lease_token text,
    lease_until timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    reason_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, account_id, event_key, fingerprint)
);
CREATE INDEX whatsapp_inbox_due ON lumiere_whatsapp.inbox (state, next_attempt_at, id);
CREATE INDEX whatsapp_inbox_identity ON lumiere_whatsapp.inbox
    (organization_id, account_id, event_key);

CREATE TABLE lumiere_whatsapp.inbox_attempt (
    id bigserial PRIMARY KEY,
    inbox_id bigint NOT NULL REFERENCES lumiere_whatsapp.inbox(id),
    lease_token text NOT NULL,
    outcome text NOT NULL,
    reason_code text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lumiere_whatsapp.outbox (
    intent_key text PRIMARY KEY,
    organization_id text NOT NULL,
    company_id text NOT NULL,
    account_id text NOT NULL,
    operational_message_id text NOT NULL,
    review_digest text NOT NULL CHECK (length(review_digest) = 64),
    payload_digest text NOT NULL CHECK (length(payload_digest) = 64),
    state text NOT NULL DEFAULT 'prepared'
        CHECK (state IN ('prepared', 'attempted', 'accepted', 'rejected', 'unknown')),
    provider_message_id text,
    attempted_at timestamptz,
    finished_at timestamptz,
    UNIQUE (organization_id, operational_message_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA lumiere_whatsapp FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA lumiere_whatsapp FROM PUBLIC;

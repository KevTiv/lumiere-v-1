-- Additive transport migration: immutable reviews and recipient event facts.
CREATE TABLE lumiere_whatsapp.dispatch_review (
    id text PRIMARY KEY CHECK (length(id)=64),
    organization_id text NOT NULL,
    company_id text NOT NULL,
    account_id text NOT NULL,
    conversation_id text NOT NULL,
    conversation_message_id text NOT NULL,
    operational_message_id text NOT NULL,
    actor_identity text NOT NULL,
    source_digest text NOT NULL CHECK (length(source_digest)=64),
    approved_payload_digest text NOT NULL CHECK (length(approved_payload_digest)=64),
    choice_json text NOT NULL CHECK (octet_length(choice_json)<=131072),
    recipient text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
CREATE INDEX whatsapp_review_source ON lumiere_whatsapp.dispatch_review
    (organization_id,company_id,conversation_message_id);
CREATE UNIQUE INDEX whatsapp_outbox_provider ON lumiere_whatsapp.outbox
    (organization_id,account_id,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX whatsapp_outbox_daily ON lumiere_whatsapp.outbox
    (organization_id,account_id,attempted_at);

CREATE TABLE lumiere_whatsapp.recipient_state (
    organization_id text NOT NULL,
    account_id text NOT NULL,
    recipient text NOT NULL,
    last_customer_seconds bigint,
    stopped_at timestamptz,
    PRIMARY KEY (organization_id,account_id,recipient)
);
REVOKE ALL ON ALL TABLES IN SCHEMA lumiere_whatsapp FROM PUBLIC;

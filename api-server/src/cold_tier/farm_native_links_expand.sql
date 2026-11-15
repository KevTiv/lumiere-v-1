CREATE TABLE IF NOT EXISTS lumiere_platform.farm_processing_link (
    event_id bigint PRIMARY KEY,
    event_revision integer NOT NULL CHECK (event_revision > 0),
    batch_id bigint NOT NULL,
    organization_id numeric(20, 0) NOT NULL,
    company_id numeric(20, 0) NOT NULL,
    manufacturing_order_id numeric(20, 0) NOT NULL CHECK (manufacturing_order_id > 0),
    live_lot_id numeric(20, 0) NOT NULL CHECK (live_lot_id > 0),
    output_lot_id numeric(20, 0) NOT NULL CHECK (output_lot_id > 0),
    evidence jsonb CHECK (jsonb_typeof(evidence) = 'object'),
    linked_by text NOT NULL,
    linked_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, company_id, manufacturing_order_id),
    UNIQUE (organization_id, company_id, output_lot_id),
    FOREIGN KEY (organization_id, company_id, batch_id, event_id)
        REFERENCES lumiere_platform.farm_batch_event(organization_id, company_id, batch_id, id)
);

CREATE INDEX IF NOT EXISTS farm_processing_link_batch
    ON lumiere_platform.farm_processing_link (organization_id, company_id, batch_id, event_id DESC);

CREATE TABLE IF NOT EXISTS lumiere_platform.farm_live_lot_link (
    organization_id numeric(20, 0) NOT NULL,
    company_id numeric(20, 0) NOT NULL,
    live_lot_id numeric(20, 0) NOT NULL CHECK (live_lot_id > 0),
    batch_id bigint NOT NULL,
    PRIMARY KEY (organization_id, company_id, live_lot_id),
    FOREIGN KEY (organization_id, company_id, batch_id)
        REFERENCES lumiere_platform.farm_batch(organization_id, company_id, id)
);

CREATE TABLE IF NOT EXISTS lumiere_platform.farm_cost_link (
    organization_id numeric(20, 0) NOT NULL,
    company_id numeric(20, 0) NOT NULL,
    journal_line_id numeric(20, 0) NOT NULL CHECK (journal_line_id > 0),
    batch_id bigint NOT NULL,
    source jsonb NOT NULL,
    linked_by text NOT NULL,
    linked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, company_id, journal_line_id),
    FOREIGN KEY (organization_id, company_id, batch_id)
        REFERENCES lumiere_platform.farm_batch(organization_id, company_id, id)
);

CREATE INDEX IF NOT EXISTS farm_cost_link_batch
    ON lumiere_platform.farm_cost_link (organization_id, company_id, batch_id, journal_line_id DESC);

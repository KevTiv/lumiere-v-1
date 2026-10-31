-- Field decisions are independent from row readiness. Original source remains
-- immutable, and both the current projection and every audit snapshot retain
-- which values an operator actually confirmed.
alter table lumiere_platform.import_review_item
    add column confirmed_fields jsonb not null default '[]'::jsonb
        check (jsonb_typeof(confirmed_fields) = 'array');
alter table lumiere_platform.import_review_decision
    add column confirmed_fields jsonb not null default '[]'::jsonb
        check (jsonb_typeof(confirmed_fields) = 'array');

-- Existing row confirmations explicitly confirmed every supplied value.
update lumiere_platform.import_review_item as item
set confirmed_fields = coalesce((
    select jsonb_agg(entry.key order by entry.key)
    from jsonb_each_text(item.proposed_json) as entry
    where entry.value is not null and entry.value <> ''
), '[]'::jsonb)
where state = 'confirmed';
update lumiere_platform.import_review_decision as decision
set confirmed_fields = coalesce((
    select jsonb_agg(entry.key order by entry.key)
    from jsonb_each_text(decision.proposed_json) as entry
    where entry.value is not null and entry.value <> ''
), '[]'::jsonb)
where state = 'confirmed';

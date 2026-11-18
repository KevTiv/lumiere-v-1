-- Contract step for module_backfill_provenance. The six-column constraint added
-- by the expand migration now identifies a source row. The original
-- five-column constraint would still reject a second worksheet that reuses a
-- row number, so it is dropped here, after every writer is worksheet-aware.
do $$
declare original_key text;
begin
    select conname into strict original_key
    from pg_constraint
    where conrelid = 'lumiere_platform.module_backfill_record'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (organization_id, company_id, module, source_sha256, source_row)';
    execute format('alter table lumiere_platform.module_backfill_record drop constraint %I', original_key);
end
$$;

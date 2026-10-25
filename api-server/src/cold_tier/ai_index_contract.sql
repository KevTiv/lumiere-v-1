-- Keep legacy payload slots until the SpacetimeDB row layout can be retired
-- through an audited migration. Removing them here would let a later projector
-- recreate or lose data while the live producer still contains the fields.
-- Backfill and verification archive exact payloads; new producer writes leave
-- the slots empty. Neither these slots nor the archive are canonical evidence.
SELECT 1;

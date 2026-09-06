//! Cold-tier read plan and compiler types.
//!
//! A [`ResourceReadPlan`] is built once per authenticated request by the
//! existing session/auth resolution layer and then compiled into either a
//! SpacetimeDB SQL query or a Postgres SQL query.  Both compilers produce
//! queries that satisfy the same authorization, company scope, field
//! projection, ordering, and pagination constraints — preventing the hot and
//! cold paths from diverging on access-control semantics.
//!
//! ## Relationship to existing code
//!
//! Today `query_exec.rs` and `stdb-auth` inline the resolution of org scope,
//! field restrictions, and resource-specific predicates. These types are the
//! shared representation for resources that are actually archive-capable.
//!
//! ## Non-negotiable invariants (from the plan)
//!
//! 1. All cold reads use the same resolved read contract as hot reads.
//!    No independent PG authorization or filter logic.
//! 2. Predicates are represented structurally to prevent unparenthesised
//!    boolean operator precedence bugs.
//! 3. `page` must be bounded — archive-capable reads are never unbounded.

pub mod commit_projection;
pub mod conventions;
pub mod cursor;
pub mod finalization_worker;
pub mod hydration;
pub mod ledger;
pub mod migrate;
pub mod pg_codec;
pub mod pg_pool;
pub mod pos_order_read;
pub mod projection_observability;
pub mod projection_worker;
pub mod read_descriptor;
pub mod reconciliation;
pub mod reconstruction;

mod archive_descriptor;
mod merge;
mod pg_bind;
mod read_plan;
mod read_sql;
mod read_validation;

pub use archive_descriptor::{
    archive_read_descriptor, ArchiveReadDescriptor, PartitionExpectation,
};
pub use merge::merge_hot_cold_u64;
pub use pg_bind::{scalar_binds_to_pg, PgBind};
pub use read_plan::{
    OrderDirection, PageSpec, ReadOrder, ReadPredicate, ResourceReadPlan, ScalarValue,
};
pub use read_sql::{compile_pg_sql, compile_stdb_sql, inline_stdb_literals};
pub use read_validation::validate_resource_read_plan;

#[cfg(test)]
mod tests {
    use super::*;

    fn pos_order_plan() -> ResourceReadPlan {
        ResourceReadPlan {
            resource: "pos-orders".into(),
            table: "pos_order".into(),
            projection: vec![
                "id".into(),
                "organization_id".into(),
                "company_id".into(),
                "state".into(),
            ],
            organization_id: 42,
            company_id: Some(7),
            predicates: vec![],
            order: vec![ReadOrder {
                column: "id".into(),
                direction: OrderDirection::Desc,
            }],
            page: PageSpec {
                limit: 500,
                cursor: None,
            },
        }
    }

    #[test]
    fn pg_sql_contains_org_scope() {
        let plan = pos_order_plan();
        let (sql, binds) = compile_pg_sql(&plan).unwrap();
        assert!(
            sql.contains("\"organization_id\" = $1::NUMERIC"),
            "SQL: {sql}"
        );
        assert!(sql.contains("\"company_id\" = $2::NUMERIC"), "SQL: {sql}");
        assert!(matches!(binds[0], ScalarValue::U64(42)));
        assert!(matches!(binds[1], ScalarValue::U64(7)));
    }

    #[test]
    fn pg_sql_contains_order_and_limit() {
        let plan = pos_order_plan();
        let (sql, _) = compile_pg_sql(&plan).unwrap();
        assert!(sql.contains("FROM \"cold_pos_order\""), "SQL: {sql}");
        assert!(sql.contains("ORDER BY \"id\" DESC"), "SQL: {sql}");
        assert!(sql.contains("LIMIT 500"), "SQL: {sql}");
    }

    #[test]
    fn stdb_sql_uses_question_mark_placeholders() {
        let plan = pos_order_plan();
        let (sql, _) = compile_stdb_sql(&plan).unwrap();
        assert!(sql.contains("`organization_id` = ?"), "SQL: {sql}");
    }

    #[test]
    fn or_predicate_is_parenthesised() {
        let mut plan = pos_order_plan();
        plan.predicates.push(ReadPredicate::Or(
            Box::new(ReadPredicate::IsNull {
                column: "company_id".into(),
            }),
            Box::new(ReadPredicate::Eq {
                column: "company_id".into(),
                value: ScalarValue::U64(7),
            }),
        ));
        let (sql, _) = compile_pg_sql(&plan).unwrap();
        assert!(
            sql.contains("(\"company_id\" IS NULL OR \"company_id\" ="),
            "SQL: {sql}"
        );
    }

    #[test]
    fn in_predicate_with_empty_values_compiles_to_false() {
        let mut plan = pos_order_plan();
        plan.predicates.push(ReadPredicate::In {
            column: "company_id".into(),
            values: vec![],
        });
        let (sql, _) = compile_pg_sql(&plan).unwrap();
        assert!(sql.contains("AND FALSE"), "SQL: {sql}");
    }

    #[test]
    fn cursor_applies_keyset_predicate() {
        let mut plan = pos_order_plan();
        let cursor = cursor::encode_cursor(&plan.order, &[ScalarValue::U64(100)]).unwrap();
        plan.page.cursor = Some(cursor);
        let (sql, binds) = compile_pg_sql(&plan).unwrap();
        assert!(sql.contains("\"id\" < $3::NUMERIC"), "SQL: {sql}");
        assert!(matches!(binds[2], ScalarValue::U64(100)));
    }

    #[test]
    fn malformed_cursor_is_rejected() {
        let mut plan = pos_order_plan();
        plan.page.cursor = Some("not-a-valid-cursor!!".into());
        assert!(compile_pg_sql(&plan).is_err());
    }

    #[test]
    fn projection_cast_suffix_applies_for_pg_and_strips_for_stdb() {
        let mut plan = pos_order_plan();
        plan.projection = vec![
            "id::TEXT".into(),
            "organization_id".into(),
            "company_id".into(),
            "state".into(),
        ];

        let (pg_sql, _) = compile_pg_sql(&plan).unwrap();
        assert!(pg_sql.contains("\"id\"::TEXT"), "SQL: {pg_sql}");

        let (stdb_sql, _) = compile_stdb_sql(&plan).unwrap();
        assert!(stdb_sql.contains("`id`"), "SQL: {stdb_sql}");
        assert!(!stdb_sql.contains("::TEXT"), "SQL: {stdb_sql}");
    }

    #[test]
    fn inline_stdb_literals_substitutes_in_order() {
        let mut plan = pos_order_plan();
        plan.predicates.push(ReadPredicate::Eq {
            column: "state".into(),
            value: ScalarValue::Text("it's fine".into()),
        });
        let (sql, binds) = compile_stdb_sql(&plan).unwrap();
        let inlined = inline_stdb_literals(&sql, &binds);

        assert!(!inlined.contains('?'), "SQL: {inlined}");
        assert!(inlined.contains("= 42"), "SQL: {inlined}");
        assert!(inlined.contains("'it''s fine'"), "SQL: {inlined}");
    }

    #[test]
    fn arbitrary_resource_and_table_are_rejected_before_sql_emission() {
        let mut plan = pos_order_plan();
        plan.resource = "caller-selected-table".into();
        assert!(matches!(
            compile_pg_sql(&plan),
            Err(cursor::CursorError::InvalidPlan(_))
        ));

        let mut plan = pos_order_plan();
        plan.table = "audit_log; DROP TABLE company".into();
        assert!(matches!(
            compile_stdb_sql(&plan),
            Err(cursor::CursorError::InvalidPlan(_))
        ));
    }

    #[test]
    fn arbitrary_projection_cast_is_rejected() {
        let mut plan = pos_order_plan();
        plan.projection.push("metadata::JSONB".into());
        assert!(compile_pg_sql(&plan).is_err());
    }

    #[test]
    fn company_owned_archive_read_requires_resolved_company_scope() {
        let columns =
            pg_codec::load_columns(lumiere_contracts::manifests::CODEC_MANIFEST, "pos_order")
                .unwrap();
        let plan = ResourceReadPlan {
            resource: "pos-orders".into(),
            table: "pos_order".into(),
            projection: pg_codec::projection_with_pg_casts(&columns),
            organization_id: 42,
            company_id: None,
            predicates: vec![],
            order: vec![ReadOrder {
                column: "id".into(),
                direction: OrderDirection::Desc,
            }],
            page: PageSpec {
                limit: 100,
                cursor: None,
            },
        };

        assert!(matches!(
            compile_pg_sql(&plan),
            Err(cursor::CursorError::InvalidPlan(message))
                if message.contains("requires resolved company scope")
        ));
    }
}

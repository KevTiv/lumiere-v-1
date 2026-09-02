//! Ten-market workflow template packs (procurement / expense / finance / evidence).
//!
//! Templates are data-only assets. Materialization inserts versioned workflows
//! keyed by market + template; pack updates must not silently rewrite timers (WF-18).

use serde::Deserialize;
use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

use super::calendar::{
    calculate_deadline_from_delay_seconds, workflow_calendar, workflow_calendar_exception,
    workflow_calendar_version, WorkflowCalendarVersion, WorkflowDeadlineEvidence,
};
use super::definitions::{
    create_workflow, publish_workflow_version, upsert_workflow_edge, upsert_workflow_node,
    workflow, workflow_edge, workflow_node, workflow_version, CreateWorkflowParams,
    UpsertWorkflowEdgeParams, UpsertWorkflowNodeParams, WorkflowBranchKind, WorkflowHumanTaskKind,
    WorkflowNodeKind, WorkflowTaskAssignment, WorkflowTaskPolicy, WorkflowTimerKind,
    WorkflowTimerPolicy, WorkflowTrigger, WorkflowVersionStatus,
};
use super::delivery::{workflow_timer, WorkflowTimer, WorkflowTimerStatus};
use super::runtime::workflow_instance;

const FOUNDATION_ASSET: &str =
    include_str!("../../assets/workflow_packs/templates-foundation-v1.json");

#[derive(Debug, Deserialize)]
struct TemplatePackAsset {
    schema_version: u32,
    template_kinds: Vec<TemplateKindSeed>,
    markets: Vec<MarketSeed>,
}

#[derive(Debug, Deserialize, Clone)]
struct TemplateKindSeed {
    template_key: String,
    model: String,
    name: String,
    description: String,
}

#[derive(Debug, Deserialize, Clone)]
struct MarketSeed {
    market: String,
    locale: String,
    calendar_key: String,
    content_hash: String,
    source: SourceSeed,
}

#[derive(Debug, Deserialize, Clone)]
struct SourceSeed {
    authority: String,
    title: String,
    url: String,
    retrieved_on: String,
    effective_year: u32,
}

#[derive(Default, Clone, Debug)]
pub struct TemplateSeedSummary {
    pub inserted_workflows: u32,
    pub replayed_workflows: u32,
}

/// Parse and validate the foundation template asset (10 markets × 4 kinds).
// ponytail: private — only used in this module; pub(crate) leaked private seed types
fn foundation_template_packs() -> Result<(Vec<TemplateKindSeed>, Vec<MarketSeed>), String> {
    let asset: TemplatePackAsset = serde_json::from_str(FOUNDATION_ASSET)
        .map_err(|error| format!("workflow template foundation asset is invalid: {error}"))?;
    if asset.schema_version != 1 {
        return Err("workflow template foundation asset schema_version must be 1".to_string());
    }
    if asset.markets.len() != 10 {
        return Err("workflow template foundation asset must contain ten markets".to_string());
    }
    if asset.template_kinds.len() != 4 {
        return Err(
            "workflow template foundation asset must contain four template kinds".to_string(),
        );
    }
    Ok((asset.template_kinds, asset.markets))
}

/// Idempotently materialize template drafts for an organization (company-global).
pub(crate) fn activate_foundation_workflow_template_packs(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<TemplateSeedSummary, String> {
    let (kinds, markets) = foundation_template_packs()?;
    let mut summary = TemplateSeedSummary::default();
    for market in markets {
        for kind in &kinds {
            match materialize_market_template(ctx, organization_id, &market, kind)? {
                true => summary.inserted_workflows += 1,
                false => summary.replayed_workflows += 1,
            }
        }
    }
    Ok(summary)
}

fn materialize_market_template(
    ctx: &ReducerContext,
    organization_id: u64,
    market: &MarketSeed,
    kind: &TemplateKindSeed,
) -> Result<bool, String> {
    let workflow_key = format!(
        "pack.{}.{}.v1",
        market.market.to_ascii_lowercase(),
        kind.template_key
    );
    if ctx.db.workflow().iter().any(|row| {
        row.organization_id == organization_id
            && row.company_id.is_none()
            && row.workflow_key == workflow_key
    }) {
        return Ok(false);
    }

    let metadata = serde_json::json!({
        "pack": {
            "market": market.market,
            "locale": market.locale,
            "calendar_key": market.calendar_key,
            "content_hash": market.content_hash,
            "template_key": kind.template_key,
            "source": {
                "authority": market.source.authority,
                "title": market.source.title,
                "url": market.source.url,
                "retrieved_on": market.source.retrieved_on,
                "effective_year": market.source.effective_year,
            }
        }
    })
    .to_string();

    create_workflow(
        ctx,
        organization_id,
        None,
        CreateWorkflowParams {
            workflow_key: workflow_key.clone(),
            model: kind.model.clone(),
            name: format!("{} ({})", kind.name, market.market),
            description: Some(kind.description.clone()),
            trigger: WorkflowTrigger::Signal,
            schema_version: 1,
            snapshot_fields: vec![],
            metadata: Some(metadata),
        },
    )?;

    let workflow = ctx
        .db
        .workflow()
        .iter()
        .find(|row| {
            row.organization_id == organization_id
                && row.company_id.is_none()
                && row.workflow_key == workflow_key
        })
        .ok_or("pack workflow missing after create")?;
    let version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&workflow.id)
        .find(|row| row.status == WorkflowVersionStatus::Draft)
        .ok_or("pack workflow draft missing")?;

    let task_kind = match kind.template_key.as_str() {
        "evidence_review" => WorkflowHumanTaskKind::EvidenceReview,
        _ => WorkflowHumanTaskKind::ApproveReject,
    };
    let assignment = if kind.template_key == "finance_escalation" {
        WorkflowTaskAssignment::AllCandidates
    } else {
        WorkflowTaskAssignment::AnyCandidate
    };
    let escalation_delay_seconds = 86_400u64;

    let mut revision = version.draft_revision;
    upsert_workflow_node(
        ctx,
        organization_id,
        version.id,
        revision,
        UpsertWorkflowNodeParams {
            node_key: "start".to_string(),
            name: "Start".to_string(),
            kind: WorkflowNodeKind::Start,
            sequence: 1,
            split_kind: WorkflowBranchKind::None,
            join_kind: WorkflowBranchKind::None,
            action: None,
            task_policy: None,
            timer_policy: None,
            retry_policy: None,
            subflow: None,
            metadata: Some(pack_node_metadata(market, kind, "start", None)),
        },
    )?;
    revision += 1;
    upsert_workflow_node(
        ctx,
        organization_id,
        version.id,
        revision,
        UpsertWorkflowNodeParams {
            node_key: "race".to_string(),
            name: "Approval vs escalation".to_string(),
            kind: WorkflowNodeKind::Fork,
            sequence: 2,
            split_kind: WorkflowBranchKind::Or,
            join_kind: WorkflowBranchKind::None,
            action: None,
            task_policy: None,
            timer_policy: None,
            retry_policy: None,
            subflow: None,
            metadata: Some(pack_node_metadata(
                market,
                kind,
                "race",
                Some(serde_json::json!({
                    "split": "or",
                    "branches": ["approve", "escalate"],
                })),
            )),
        },
    )?;
    revision += 1;
    upsert_workflow_node(
        ctx,
        organization_id,
        version.id,
        revision,
        UpsertWorkflowNodeParams {
            node_key: "approve".to_string(),
            name: "Approve".to_string(),
            kind: WorkflowNodeKind::HumanTask,
            sequence: 3,
            split_kind: WorkflowBranchKind::None,
            join_kind: WorkflowBranchKind::None,
            action: None,
            task_policy: Some(WorkflowTaskPolicy {
                kind: task_kind,
                assignment,
                candidate_role_ids: vec![1],
                candidate_group_ids: vec![],
                candidate_unit_ids: vec![],
                require_comment_on_reject: true,
            }),
            timer_policy: None,
            retry_policy: None,
            subflow: None,
            metadata: Some(pack_node_metadata(
                market,
                kind,
                "approve",
                Some(serde_json::json!({
                    "escalation_calendar_key": market.calendar_key,
                    "escalation_delay_seconds": escalation_delay_seconds,
                    "branch": "approve",
                })),
            )),
        },
    )?;
    revision += 1;
    upsert_workflow_node(
        ctx,
        organization_id,
        version.id,
        revision,
        UpsertWorkflowNodeParams {
            node_key: "escalate".to_string(),
            name: "Escalation timer".to_string(),
            kind: WorkflowNodeKind::Timer,
            sequence: 4,
            split_kind: WorkflowBranchKind::None,
            join_kind: WorkflowBranchKind::None,
            action: None,
            task_policy: None,
            timer_policy: Some(WorkflowTimerPolicy {
                kind: WorkflowTimerKind::Escalation,
                delay_seconds: escalation_delay_seconds,
                calendar_key: Some(market.calendar_key.clone()),
            }),
            retry_policy: None,
            subflow: None,
            metadata: Some(pack_node_metadata(
                market,
                kind,
                "escalate",
                Some(serde_json::json!({
                    "calendar_key": market.calendar_key,
                    "delay_seconds": escalation_delay_seconds,
                    "branch": "escalate",
                })),
            )),
        },
    )?;
    revision += 1;
    upsert_workflow_node(
        ctx,
        organization_id,
        version.id,
        revision,
        UpsertWorkflowNodeParams {
            node_key: "join".to_string(),
            name: "Race join".to_string(),
            kind: WorkflowNodeKind::Join,
            sequence: 5,
            split_kind: WorkflowBranchKind::None,
            join_kind: WorkflowBranchKind::Or,
            action: None,
            task_policy: None,
            timer_policy: None,
            retry_policy: None,
            subflow: None,
            metadata: Some(pack_node_metadata(market, kind, "join", None)),
        },
    )?;
    revision += 1;
    upsert_workflow_node(
        ctx,
        organization_id,
        version.id,
        revision,
        UpsertWorkflowNodeParams {
            node_key: "end".to_string(),
            name: "End".to_string(),
            kind: WorkflowNodeKind::End,
            sequence: 6,
            split_kind: WorkflowBranchKind::None,
            join_kind: WorkflowBranchKind::None,
            action: None,
            task_policy: None,
            timer_policy: None,
            retry_policy: None,
            subflow: None,
            metadata: Some(pack_node_metadata(market, kind, "end", None)),
        },
    )?;
    revision += 1;
    upsert_workflow_edge(
        ctx,
        organization_id,
        version.id,
        revision,
        UpsertWorkflowEdgeParams {
            edge_key: "to-race".to_string(),
            from_node_key: "start".to_string(),
            to_node_key: "race".to_string(),
            sequence: 1,
            signal_key: Some("start".to_string()),
            condition: None,
            metadata: Some(pack_edge_metadata(market, kind, "to-race", "start")),
        },
    )?;
    revision += 1;
    upsert_workflow_edge(
        ctx,
        organization_id,
        version.id,
        revision,
        UpsertWorkflowEdgeParams {
            edge_key: "race-approve".to_string(),
            from_node_key: "race".to_string(),
            to_node_key: "approve".to_string(),
            sequence: 1,
            signal_key: None,
            condition: None,
            metadata: Some(pack_edge_metadata(market, kind, "race-approve", "approve")),
        },
    )?;
    revision += 1;
    upsert_workflow_edge(
        ctx,
        organization_id,
        version.id,
        revision,
        UpsertWorkflowEdgeParams {
            edge_key: "race-escalate".to_string(),
            from_node_key: "race".to_string(),
            to_node_key: "escalate".to_string(),
            sequence: 2,
            signal_key: None,
            condition: None,
            metadata: Some(pack_edge_metadata(
                market,
                kind,
                "race-escalate",
                "escalate",
            )),
        },
    )?;
    revision += 1;
    upsert_workflow_edge(
        ctx,
        organization_id,
        version.id,
        revision,
        UpsertWorkflowEdgeParams {
            edge_key: "approved".to_string(),
            from_node_key: "approve".to_string(),
            to_node_key: "join".to_string(),
            sequence: 1,
            signal_key: Some("approved".to_string()),
            condition: None,
            metadata: Some(pack_edge_metadata(market, kind, "approved", "join")),
        },
    )?;
    revision += 1;
    upsert_workflow_edge(
        ctx,
        organization_id,
        version.id,
        revision,
        UpsertWorkflowEdgeParams {
            edge_key: "rejected".to_string(),
            from_node_key: "approve".to_string(),
            to_node_key: "join".to_string(),
            sequence: 2,
            signal_key: Some("rejected".to_string()),
            condition: None,
            metadata: Some(pack_edge_metadata(market, kind, "rejected", "join")),
        },
    )?;
    revision += 1;
    upsert_workflow_edge(
        ctx,
        organization_id,
        version.id,
        revision,
        UpsertWorkflowEdgeParams {
            edge_key: "escalated".to_string(),
            from_node_key: "escalate".to_string(),
            to_node_key: "join".to_string(),
            sequence: 1,
            signal_key: Some("fired".to_string()),
            condition: None,
            metadata: Some(pack_edge_metadata(market, kind, "escalated", "join")),
        },
    )?;
    revision += 1;
    upsert_workflow_edge(
        ctx,
        organization_id,
        version.id,
        revision,
        UpsertWorkflowEdgeParams {
            edge_key: "joined".to_string(),
            from_node_key: "join".to_string(),
            to_node_key: "end".to_string(),
            sequence: 1,
            signal_key: None,
            condition: None,
            metadata: Some(pack_edge_metadata(market, kind, "joined", "end")),
        },
    )?;
    revision += 1;
    publish_workflow_version(ctx, organization_id, version.id, revision)?;
    Ok(true)
}

fn pack_node_metadata(
    market: &MarketSeed,
    kind: &TemplateKindSeed,
    node_role: &str,
    extra: Option<serde_json::Value>,
) -> String {
    let mut value = serde_json::json!({
        "pack": {
            "market": market.market,
            "locale": market.locale,
            "calendar_key": market.calendar_key,
            "content_hash": market.content_hash,
            "template_key": kind.template_key,
            "model": kind.model,
            "source": {
                "authority": market.source.authority,
                "title": market.source.title,
                "url": market.source.url,
                "retrieved_on": market.source.retrieved_on,
                "effective_year": market.source.effective_year,
            }
        },
        "node_role": node_role,
    });
    if let Some(extra) = extra {
        if let Some(object) = value.as_object_mut() {
            if let Some(extra_object) = extra.as_object() {
                for (key, nested) in extra_object {
                    object.insert(key.clone(), nested.clone());
                }
            } else {
                object.insert("detail".to_string(), extra);
            }
        }
    }
    value.to_string()
}

fn pack_edge_metadata(
    market: &MarketSeed,
    kind: &TemplateKindSeed,
    edge_role: &str,
    outcome: &str,
) -> String {
    serde_json::json!({
        "pack": {
            "market": market.market,
            "locale": market.locale,
            "calendar_key": market.calendar_key,
            "content_hash": market.content_hash,
            "template_key": kind.template_key,
        },
        "edge_role": edge_role,
        "outcome": outcome,
    })
    .to_string()
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecomputeWorkflowTimersParams {
    pub company_id: u64,
    pub calendar_key: String,
    pub expected_pending_count: u64,
    pub confirm: bool,
    pub reason: String,
}

/// Authorized timer recomputation with before/after evidence.
///
/// `confirm = false` performs impact analysis only (no timer mutation).
/// `confirm = true` recalculates `due_at` from the timer node's calendar policy
/// (created_at + delay via working-time math) and bumps revision/correlation.
/// Pack updates alone never rewrite timers (WF-18).
#[reducer]
pub fn recompute_workflow_timers_for_calendar(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RecomputeWorkflowTimersParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_timer", "write")?;
    if params.reason.trim().is_empty() {
        return Err("recompute reason is required".to_string());
    }
    if params.calendar_key.trim().is_empty() {
        return Err("calendar_key is required".to_string());
    }

    let pending: Vec<WorkflowTimer> = ctx
        .db
        .workflow_timer()
        .iter()
        .filter(|timer| {
            timer.organization_id == organization_id
                && timer.company_id == params.company_id
                && timer.status == WorkflowTimerStatus::Pending
                && timer.semantic_key.contains(&params.calendar_key)
        })
        .collect();

    if pending.len() as u64 != params.expected_pending_count {
        return Err(format!(
            "stale timer recomputation: expected {} pending timers, found {}",
            params.expected_pending_count,
            pending.len()
        ));
    }

    let mut projections = Vec::with_capacity(pending.len());
    for timer in &pending {
        let projection = project_timer_recompute(ctx, timer, &params.calendar_key)?;
        projections.push(projection);
    }

    let before_ids: Vec<u64> = pending.iter().map(|timer| timer.id).collect();
    let projected_json: Vec<serde_json::Value> = projections
        .iter()
        .map(|row| {
            serde_json::json!({
                "timer_id": row.timer_id,
                "before_due_at_micros": row.before_due_at_micros,
                "after_due_at_micros": row.after_due_at_micros,
                "calendar_content_hash": row.calendar_content_hash,
                "delay_seconds": row.delay_seconds,
            })
        })
        .collect();

    if !params.confirm {
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(params.company_id),
                table_name: "workflow_timer",
                record_id: 0,
                action: "IMPACT_ANALYSIS",
                old_values: Some(
                    serde_json::json!({
                        "calendar_key": params.calendar_key,
                        "pending_timer_ids": before_ids,
                        "projections": projected_json,
                    })
                    .to_string(),
                ),
                new_values: None,
                changed_fields: vec![],
                metadata: Some(
                    serde_json::json!({
                        "confirm": false,
                        "reason": params.reason,
                    })
                    .to_string(),
                ),
            },
        );
        return Ok(());
    }

    let mut after_ids = Vec::new();
    for (timer, projection) in pending.into_iter().zip(projections.into_iter()) {
        let next_revision = timer.revision.saturating_add(1);
        let timer_id = timer.id;
        let new_due =
            spacetimedb::Timestamp::from_micros_since_unix_epoch(projection.after_due_at_micros);
        ctx.db.workflow_timer().id().update(WorkflowTimer {
            due_at: new_due,
            revision: next_revision,
            correlation_id: format!("recompute:{}:{}", params.calendar_key, timer_id),
            ..timer
        });
        after_ids.push(timer_id);
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "workflow_timer",
            record_id: 0,
            action: "RECOMPUTE",
            old_values: Some(
                serde_json::json!({
                    "calendar_key": params.calendar_key,
                    "pending_timer_ids": before_ids,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "calendar_key": params.calendar_key,
                    "pending_timer_ids": after_ids,
                    "projections": projected_json,
                    "due_at_rewritten": true,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "due_at".to_string(),
                "revision".to_string(),
                "correlation_id".to_string(),
            ],
            metadata: Some(
                serde_json::json!({
                    "confirm": true,
                    "reason": params.reason,
                })
                .to_string(),
            ),
        },
    );
    Ok(())
}

#[derive(Clone, Debug)]
struct TimerRecomputeProjection {
    timer_id: u64,
    before_due_at_micros: i64,
    after_due_at_micros: i64,
    calendar_content_hash: String,
    delay_seconds: u64,
}

fn project_timer_recompute(
    ctx: &ReducerContext,
    timer: &WorkflowTimer,
    calendar_key: &str,
) -> Result<TimerRecomputeProjection, String> {
    let before = timer.due_at.to_micros_since_unix_epoch();
    let (delay_seconds, evidence) = resolve_timer_calendar_deadline(ctx, timer, calendar_key)?;
    let after = evidence.utc_instant.to_micros_since_unix_epoch();
    Ok(TimerRecomputeProjection {
        timer_id: timer.id,
        before_due_at_micros: before,
        after_due_at_micros: after,
        calendar_content_hash: evidence.calendar_content_hash,
        delay_seconds,
    })
}

fn resolve_timer_calendar_deadline(
    ctx: &ReducerContext,
    timer: &WorkflowTimer,
    calendar_key: &str,
) -> Result<(u64, WorkflowDeadlineEvidence), String> {
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&timer.instance_id)
        .ok_or_else(|| {
            format!(
                "workflow instance {} missing for timer {}",
                timer.instance_id, timer.id
            )
        })?;
    if instance.organization_id != timer.organization_id || instance.company_id != timer.company_id
    {
        return Err("timer instance tenant mismatch".to_string());
    }

    let edge = ctx
        .db
        .workflow_edge()
        .id()
        .find(&timer.edge_id)
        .ok_or_else(|| {
            format!(
                "workflow edge {} missing for timer {}",
                timer.edge_id, timer.id
            )
        })?;
    if edge.workflow_version_id != instance.workflow_version_id {
        return Err("timer edge is not pinned to the instance workflow version".to_string());
    }

    let node = ctx
        .db
        .workflow_node()
        .workflow_node_by_key()
        .filter(&edge.from_node_key)
        .find(|row| row.workflow_version_id == instance.workflow_version_id)
        .ok_or_else(|| {
            format!(
                "timer source node '{}' missing on version {}",
                edge.from_node_key, instance.workflow_version_id
            )
        })?;
    let policy = node
        .timer_policy
        .as_ref()
        .ok_or_else(|| format!("node '{}' has no timer policy for recompute", node.node_key))?;
    let policy_calendar = policy
        .calendar_key
        .as_deref()
        .ok_or_else(|| format!("node '{}' timer policy has no calendar_key", node.node_key))?;
    if policy_calendar != calendar_key {
        return Err(format!(
            "timer {} calendar_key mismatch: policy={policy_calendar} requested={calendar_key}",
            timer.id
        ));
    }

    let version = latest_calendar_version(ctx, timer.organization_id, calendar_key)?;
    let exceptions: Vec<_> = ctx
        .db
        .workflow_calendar_exception()
        .workflow_calendar_exception_by_version()
        .filter(&version.id)
        .collect();
    let evidence = calculate_deadline_from_delay_seconds(
        &version,
        &exceptions,
        timer.created_at,
        policy.delay_seconds,
    )?;
    Ok((policy.delay_seconds, evidence))
}

fn latest_calendar_version(
    ctx: &ReducerContext,
    organization_id: u64,
    calendar_key: &str,
) -> Result<WorkflowCalendarVersion, String> {
    let calendar_key_owned = calendar_key.to_string();
    let calendar = ctx
        .db
        .workflow_calendar()
        .workflow_calendar_by_organization_and_key()
        .filter((&organization_id, &calendar_key_owned))
        .next()
        .ok_or_else(|| format!("calendar '{calendar_key}' not found"))?;
    let version = ctx
        .db
        .workflow_calendar_version()
        .workflow_calendar_version_by_calendar()
        .filter(&calendar.id)
        .max_by_key(|version| (version.version_number, version.id))
        .ok_or_else(|| format!("calendar '{calendar_key}' has no versions"))?;
    if version.organization_id != calendar.organization_id
        || version.organization_id != organization_id
    {
        return Err("calendar version does not belong to calendar organization".to_string());
    }
    if ctx
        .db
        .workflow_calendar_exception()
        .workflow_calendar_exception_by_version()
        .filter(&version.id)
        .any(|exception| exception.organization_id != version.organization_id)
    {
        return Err(
            "calendar exception does not belong to calendar version organization".to_string(),
        );
    }
    Ok(version)
}

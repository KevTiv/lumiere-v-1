//! Focused reducer tests for durable queue delivery semantics.
use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{insert_organization_with_owner, CreateOrganizationParams};
use crate::core::queue::{
    cancel_queue_job, claim_queue_job, complete_queue_job, enqueue_job, queue_attempt,
    queue_effect_receipt, queue_job, queue_worker, register_queue_worker,
    retry_dead_letter_queue_job, worker_heartbeat, CancelQueueJobParams, ClaimQueueJobParams,
    CompleteQueueJobParams, EnqueueJobParams, RegisterQueueWorkerParams, RetryDeadLetterJobParams,
};
use crate::types::{QueueAttemptOutcome, QueueCompletionOutcome, QueueJobStatus};

fn create_test_organization(ctx: &ReducerContext, code: &str, name: &str) -> Result<u64, String> {
    // Return the inserted row id — org `code` is not unique, so find-by-code can
    // reuse a prior QUEUE_* fixture left by `run_all_core_tests` before the e2e
    // domain loop calls `run_queue_foundation_tests` again.
    let (org, _) = insert_organization_with_owner(
        ctx,
        CreateOrganizationParams {
            name: name.to_string(),
            code: code.to_string(),
            timezone: "UTC".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            language: "en".to_string(),
            is_active: true,
            description: None,
            logo_url: None,
            website: None,
            email: None,
            phone: None,
            currency_id: None,
            metadata: None,
        },
    )?;
    Ok(org.id)
}

fn register_test_worker(
    ctx: &ReducerContext,
    organization_id: u64,
    name: &str,
    queue: &str,
) -> Result<u64, String> {
    register_queue_worker(
        ctx,
        organization_id,
        RegisterQueueWorkerParams {
            company_id: None,
            name: name.to_string(),
            queues: vec![queue.to_string()],
            metadata: None,
        },
    )?;
    ctx.db
        .queue_worker()
        .iter()
        .find(|worker| worker.organization_id == organization_id && worker.name == name)
        .map(|worker| worker.id)
        .ok_or("test queue worker was not created".to_string())
}

fn enqueue_test_job(
    ctx: &ReducerContext,
    organization_id: u64,
    semantic_key: &str,
    payload: &str,
    max_attempts: u32,
) -> Result<u64, String> {
    enqueue_job(
        ctx,
        organization_id,
        EnqueueJobParams {
            company_id: None,
            queue_name: "test".to_string(),
            job_type: "test.execute".to_string(),
            payload: payload.to_string(),
            semantic_key: semantic_key.to_string(),
            priority: 5,
            max_attempts,
            available_at_micros: None,
            correlation_id: format!("correlation:{semantic_key}"),
            causation_id: Some("queue-test".to_string()),
            metadata: None,
        },
    )?;
    ctx.db
        .queue_job()
        .iter()
        .find(|job| job.organization_id == organization_id && job.semantic_key == semantic_key)
        .map(|job| job.id)
        .ok_or("test queue job was not created".to_string())
}

fn claim_params(
    ctx: &ReducerContext,
    expected_revision: u64,
    worker_id: u64,
    token: &str,
) -> ClaimQueueJobParams {
    ClaimQueueJobParams {
        expected_revision,
        worker_id,
        lease_token: token.to_string(),
        lease_expires_at_micros: (ctx.timestamp + Duration::from_secs(60))
            .to_micros_since_unix_epoch() as u64,
    }
}

/// The trusted writer has no ERP queue permissions; authority is binding- and
/// lease-scoped. Restore the shared harness caller even on a failed probe.
pub fn test_embedding_service_authority(ctx: &ReducerContext) -> Result<(), String> {
    use crate::ai::agents::{ai_agent, create_ai_agent, CreateAiAgentParams};
    use crate::ai::metered_spend::{
        ai_metered_price, ai_metered_usage, configure_ai_metered_price, reserve_ai_metered_spend,
        ConfigureAiMeteredPriceParams, ReserveAiMeteredSpendParams,
    };
    use crate::ai::prepaid::{ai_prepaid_account, ai_prepaid_funding_entry};
    use crate::ai::spend::{
        ai_provider_attempt, ai_spend_budget, ai_spend_reservation, configure_ai_spend,
        ConfigureAiSpendParams,
    };
    use crate::core::cold_tier_identity::{cold_tier_service_identity, ColdTierServiceIdentity};
    use crate::core::queue::{
        cancel_ai_embedding_job, renew_queue_job_lease, QueueJob, QueueWorker,
        RenewQueueLeaseParams,
    };
    use crate::core::users::{user_organization, user_profile};
    let fixture = crate::test_harness::OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    create_ai_agent(
        ctx,
        org,
        Some(fixture.company_id),
        CreateAiAgentParams {
            name: format!("Queue embedding {org}"),
            model: "mistral-embed".into(),
            provider: "mistral".into(),
            temperature: 0.0,
            max_tokens: 1024,
            rate_limit_per_minute: 60,
            cost_per_1k_tokens: 0.01,
            context_window: 32000,
            top_p: 1.0,
            frequency_penalty: 0.0,
            presence_penalty: 0.0,
            is_active: true,
            is_default: false,
            allowed_models: vec!["mistral-embed".into()],
            allowed_actions: vec![],
            description: None,
            api_key_reference: None,
            system_prompt: None,
            monthly_budget: None,
            metadata: None,
        },
    )?;
    let agent = ctx
        .db
        .ai_agent()
        .ai_agent_by_org()
        .filter(org)
        .next()
        .ok_or("missing agent")?;
    let period =
        chrono::DateTime::from_timestamp_micros(ctx.timestamp.to_micros_since_unix_epoch())
            .ok_or("invalid fixture date")?
            .format("%Y-%m")
            .to_string();
    configure_ai_spend(
        ctx,
        org,
        agent.id,
        ConfigureAiSpendParams {
            billing_period: period,
            currency: "USD".into(),
            limit_units: 100,
            provider: "mistral".into(),
            model: "mistral-embed".into(),
            input_units_per_1k: 1000,
            output_units_per_1k: 1000,
        },
    )?;
    configure_ai_metered_price(
        ctx,
        org,
        agent.id,
        ConfigureAiMeteredPriceParams {
            model: "mistral-embed".into(),
            unit: "tokens".into(),
            currency: "USD".into(),
            units_per_1k: 1000,
        },
    )?;
    let binding = ColdTierServiceIdentity {
        platform_id: format!("queue-embedding-test-{org}"),
        organization_id: org,
        service_name: crate::ai::platform_runtime::WRITER_SERVICE.into(),
        identity: ctx.sender(),
        is_active: true,
        registered_by: spacetimedb::Identity::from_byte_array([241; 32]),
        registered_at: ctx.timestamp,
        retired_at: None,
    };
    ctx.db.cold_tier_service_identity().insert(binding.clone());
    let setup = reserve_ai_metered_spend(
        ctx,
        org,
        ReserveAiMeteredSpendParams {
            company_id: fixture.company_id,
            agent_id: agent.id,
            run_id: 0,
            actor_identity: ctx.sender().to_hex().to_string(),
            request_key: format!("queue:embedding:{org}"),
            model: "mistral-embed".into(),
            unit: "tokens".into(),
            allowance: 50,
        },
    );
    if let Err(error) = setup {
        ctx.db
            .cold_tier_service_identity()
            .platform_id()
            .delete(&binding.platform_id);
        return Err(error);
    }
    fn ledger(ctx: &ReducerContext, org: u64) -> Vec<(String, Vec<u8>)> {
        let mut rows = Vec::new();
        macro_rules! capture {
            ($table:ident) => {
                for row in ctx
                    .db
                    .$table()
                    .iter()
                    .filter(|row| row.organization_id == org)
                {
                    rows.push((
                        stringify!($table).to_string(),
                        spacetimedb::sats::bsatn::to_vec(&row).expect("native ledger encoding"),
                    ));
                }
            };
        }
        capture!(ai_spend_reservation);
        capture!(ai_spend_budget);
        capture!(ai_provider_attempt);
        capture!(ai_metered_price);
        capture!(ai_metered_usage);
        capture!(ai_prepaid_account);
        capture!(ai_prepaid_funding_entry);
        rows.sort();
        rows
    }
    let hold = ctx
        .db
        .ai_spend_reservation()
        .ai_spend_reservation_by_org()
        .filter(org)
        .next()
        .ok_or("missing canonical reservation")?;
    assert_eq!(hold.reserved_units, 50);
    assert_eq!(hold.status, "reserved");
    let foreign_org = create_test_organization(ctx, "QUEUE_EMBED_FOREIGN", "Foreign embedding")?;
    let job_id = enqueue_test_job(
        ctx,
        org,
        "embedding-service",
        r#"{"private":"retained"}"#,
        3,
    )?;
    let job = ctx.db.queue_job().id().find(job_id).ok_or("missing job")?;
    ctx.db.queue_job().id().update(QueueJob {
        queue_name: "embedding".into(),
        ..job
    });
    let profiles: Vec<_> = ctx
        .db
        .user_profile()
        .iter()
        .filter(|p| p.identity == ctx.sender())
        .collect();
    let memberships: Vec<_> = ctx
        .db
        .user_organization()
        .iter()
        .filter(|m| m.user_identity == ctx.sender())
        .collect();
    // A service binding must work without inheriting this test caller's owner
    // or superuser profiles. Restore the exact saved rows after the scenario.
    for profile in &profiles {
        ctx.db.user_profile().id().delete(profile.id);
    }
    for membership in &memberships {
        ctx.db.user_organization().id().delete(membership.id);
    }
    let result = (|| -> Result<(), String> {
        assert!(crate::helpers::check_permission(ctx, org, "queue_job", "write").is_err());
        assert!(crate::helpers::check_permission(ctx, org, "queue_worker", "create").is_err());
        ctx.db
            .cold_tier_service_identity()
            .platform_id()
            .update(ColdTierServiceIdentity {
                is_active: false,
                ..binding.clone()
            });
        assert!(register_test_worker(ctx, org, "unregistered", "embedding").is_err());
        ctx.db
            .cold_tier_service_identity()
            .platform_id()
            .update(binding.clone());
        assert!(register_test_worker(ctx, foreign_org, "wrong-org", "embedding").is_err());
        assert!(register_test_worker(ctx, org, "other-queue", "test").is_err());
        assert!(register_queue_worker(
            ctx,
            org,
            RegisterQueueWorkerParams {
                company_id: None,
                name: "mixed".into(),
                queues: vec!["embedding".into(), "test".into()],
                metadata: None,
            }
        )
        .is_err());
        let worker_id = register_test_worker(ctx, org, "writer", "embedding")?;
        let cancel = |revision| {
            cancel_ai_embedding_job(
                ctx,
                org,
                job_id,
                worker_id,
                revision,
                "embedding-lease".into(),
                "MeteredRecoveryRequired".into(),
            )
        };
        assert!(cancel(0).is_err(), "service cannot cancel unleased work");
        claim_queue_job(
            ctx,
            org,
            job_id,
            claim_params(ctx, 0, worker_id, "embedding-lease"),
        )?;
        assert!(cancel(0).is_err(), "stale revision must fail");
        renew_queue_job_lease(
            ctx,
            org,
            job_id,
            RenewQueueLeaseParams {
                expected_revision: 1,
                worker_id,
                lease_token: "embedding-lease".into(),
                lease_expires_at_micros: (ctx.timestamp + Duration::from_secs(120))
                    .to_micros_since_unix_epoch() as u64,
            },
        )?;
        let worker = ctx
            .db
            .queue_worker()
            .id()
            .find(worker_id)
            .ok_or("missing worker")?;
        let foreign_worker = register_test_worker(ctx, org, "foreign-logical-worker", "embedding")?;
        assert!(
            cancel_ai_embedding_job(
                ctx,
                org,
                job_id,
                foreign_worker,
                2,
                "embedding-lease".into(),
                "recovery".into(),
            )
            .is_err(),
            "cannot cancel foreign logical worker lease"
        );
        assert!(
            cancel_ai_embedding_job(
                ctx,
                org,
                job_id,
                worker_id,
                2,
                "wrong-token".into(),
                "recovery".into(),
            )
            .is_err(),
            "lease token must match"
        );
        assert!(
            cancel_queue_job(
                ctx,
                org,
                job_id,
                CancelQueueJobParams {
                    expected_revision: 2,
                    reason: "recovery".into(),
                }
            )
            .is_err(),
            "generic cancellation still requires ERP permission"
        );
        ctx.db.queue_worker().id().update(QueueWorker {
            queues: vec!["embedding".into(), "test".into()],
            ..worker.clone()
        });
        assert!(cancel(2).is_err(), "mixed worker scope must fail");
        ctx.db.queue_worker().id().update(worker);
        ctx.db
            .cold_tier_service_identity()
            .platform_id()
            .update(ColdTierServiceIdentity {
                is_active: false,
                retired_at: Some(ctx.timestamp),
                ..binding.clone()
            });
        assert!(cancel(2).is_err(), "retired writer must fail");
        for service_name in ["ai_spend_reader", "ai_skill_certifier"] {
            ctx.db
                .cold_tier_service_identity()
                .platform_id()
                .update(ColdTierServiceIdentity {
                    service_name: service_name.into(),
                    ..binding.clone()
                });
            assert!(cancel(2).is_err(), "non-writer service must fail");
        }
        ctx.db
            .cold_tier_service_identity()
            .platform_id()
            .update(ColdTierServiceIdentity {
                organization_id: foreign_org,
                ..binding.clone()
            });
        assert!(cancel(2).is_err(), "foreign organization binding must fail");
        ctx.db
            .cold_tier_service_identity()
            .platform_id()
            .update(binding.clone());
        let leased = ctx
            .db
            .queue_job()
            .id()
            .find(job_id)
            .ok_or("missing lease")?;
        ctx.db.queue_job().id().update(QueueJob {
            queue_name: "test".into(),
            ..leased.clone()
        });
        assert!(cancel(2).is_err(), "writer cannot cancel another queue");
        ctx.db.queue_job().id().update(leased);
        use crate::core::reconstruction::{
            organization_reconstruction_fence, OrganizationReconstructionFence,
        };
        ctx.db
            .organization_reconstruction_fence()
            .insert(OrganizationReconstructionFence {
                organization_id: org,
                run_id: format!("queue-fence-{org}"),
                placement_generation: 1,
                target_watermark: 0,
                target_commit_checksum: "test".into(),
                state: "restoring".into(),
                started_at: ctx.timestamp,
                updated_at: ctx.timestamp,
                completed_at: None,
                failure: None,
                current_restore_order: None,
                last_completed_restore_order: 0,
                next_batch_ordinal: 0,
            });
        assert!(
            cancel(2).is_err(),
            "service cancellation must respect reconstruction fence"
        );
        assert!(worker_heartbeat(ctx, org, worker_id).is_err());
        assert!(register_test_worker(ctx, org, "fenced", "embedding").is_err());
        assert!(renew_queue_job_lease(
            ctx,
            org,
            job_id,
            RenewQueueLeaseParams {
                expected_revision: 2,
                worker_id,
                lease_token: "embedding-lease".into(),
                lease_expires_at_micros: (ctx.timestamp + Duration::from_secs(180))
                    .to_micros_since_unix_epoch() as u64,
            }
        )
        .is_err());
        assert!(complete_queue_job(
            ctx,
            org,
            job_id,
            CompleteQueueJobParams {
                expected_revision: 2,
                worker_id,
                lease_token: "embedding-lease".into(),
                outcome: QueueCompletionOutcome::Succeeded,
                error_summary: None,
                response_fingerprint: Some("embedding-result".into()),
                retry_jitter_micros: 0,
            }
        )
        .is_err());
        ctx.db
            .organization_reconstruction_fence()
            .organization_id()
            .delete(org);
        let before_cancel = ledger(ctx, org);
        cancel(2)?;
        let retained_hold = ctx
            .db
            .ai_spend_reservation()
            .id()
            .find(hold.id)
            .ok_or("cancellation removed financial hold")?;
        assert_eq!(retained_hold.status, "reserved");
        assert_eq!(retained_hold.reserved_units, 50);
        assert_eq!(retained_hold.settled_units, 0);
        assert!(retained_hold.settled_at.is_none());
        assert!(retained_hold.settled_by.is_none());
        assert_eq!(
            ledger(ctx, org),
            before_cancel,
            "cancellation changed financial ledger"
        );
        let cancelled = ctx
            .db
            .queue_job()
            .id()
            .find(job_id)
            .ok_or("missing cancelled job")?;
        assert_eq!(cancelled.status, QueueJobStatus::Cancelled);
        assert_eq!(cancelled.payload, r#"{"private":"retained"}"#);
        assert_eq!(cancelled.revision, 3);
        assert!(!ctx
            .db
            .queue_effect_receipt()
            .iter()
            .any(|r| r.job_id == job_id));
        // Complete another native fixture to exercise receipt creation and
        // embedding payload scrubbing under the same narrow authority.
        let second = ctx.db.queue_job().insert(QueueJob {
            id: 0,
            status: QueueJobStatus::Pending,
            revision: 0,
            semantic_key: format!("embedding-complete-{org}"),
            lease_worker_id: None,
            lease_token: None,
            lease_expires_at: None,
            completed_at: None,
            cancelled_at: None,
            cancelled_by: None,
            cancellation_reason: None,
            ..cancelled
        });
        claim_queue_job(
            ctx,
            org,
            second.id,
            claim_params(ctx, 0, worker_id, "complete-lease"),
        )?;
        complete_queue_job(
            ctx,
            org,
            second.id,
            CompleteQueueJobParams {
                expected_revision: 1,
                worker_id,
                lease_token: "complete-lease".into(),
                outcome: QueueCompletionOutcome::Succeeded,
                error_summary: None,
                response_fingerprint: Some("embedding-result".into()),
                retry_jitter_micros: 0,
            },
        )?;
        let completed = ctx
            .db
            .queue_job()
            .id()
            .find(second.id)
            .ok_or("missing completed job")?;
        assert_eq!(completed.status, QueueJobStatus::Completed);
        assert_eq!(completed.payload, "{}");
        assert!(ctx
            .db
            .queue_effect_receipt()
            .iter()
            .any(|r| r.job_id == second.id));
        Ok(())
    })();
    ctx.db
        .cold_tier_service_identity()
        .platform_id()
        .delete(&binding.platform_id);
    for profile in profiles {
        ctx.db.user_profile().insert(profile);
    }
    for membership in memberships {
        ctx.db.user_organization().insert(membership);
    }
    result
}

/// Covers enqueue replay/conflict, serialized claims, completion replay and receipts.
#[spacetimedb::reducer]
pub fn test_queue_system(ctx: &ReducerContext) -> Result<(), String> {
    let organization_id = create_test_organization(ctx, "QUEUE_FINAL", "Queue Final Contract")?;
    let worker_id = register_test_worker(ctx, organization_id, "worker-a", "test")?;

    let job_id = enqueue_test_job(ctx, organization_id, "semantic:one", r#"{"b":2,"a":1}"#, 3)?;
    enqueue_test_job(
        ctx,
        organization_id,
        "semantic:one",
        r#"{ "a": 1, "b": 2 }"#,
        3,
    )?;
    let replay_count = ctx
        .db
        .queue_job()
        .iter()
        .filter(|job| job.organization_id == organization_id && job.semantic_key == "semantic:one")
        .count();
    assert_eq!(replay_count, 1, "identical replay inserted another job");

    let conflict = enqueue_job(
        ctx,
        organization_id,
        EnqueueJobParams {
            company_id: None,
            queue_name: "test".to_string(),
            job_type: "test.execute".to_string(),
            payload: r#"{"a":2}"#.to_string(),
            semantic_key: "semantic:one".to_string(),
            priority: 5,
            max_attempts: 3,
            available_at_micros: None,
            correlation_id: "correlation:semantic:one".to_string(),
            causation_id: None,
            metadata: None,
        },
    );
    assert!(
        conflict.is_err(),
        "semantic-key input conflict was accepted"
    );

    claim_queue_job(
        ctx,
        organization_id,
        job_id,
        claim_params(ctx, 0, worker_id, "lease-one"),
    )?;
    let duplicate_claim = claim_queue_job(
        ctx,
        organization_id,
        job_id,
        claim_params(ctx, 0, worker_id, "lease-two"),
    );
    assert!(
        duplicate_claim.is_err(),
        "a stale concurrent claim succeeded"
    );

    complete_queue_job(
        ctx,
        organization_id,
        job_id,
        CompleteQueueJobParams {
            expected_revision: 1,
            worker_id,
            lease_token: "lease-one".to_string(),
            outcome: QueueCompletionOutcome::Succeeded,
            error_summary: None,
            response_fingerprint: Some("response:v1".to_string()),
            retry_jitter_micros: 0,
        },
    )?;
    // Identical callback replay is a no-op even though its revision is stale.
    complete_queue_job(
        ctx,
        organization_id,
        job_id,
        CompleteQueueJobParams {
            expected_revision: 1,
            worker_id,
            lease_token: "lease-one".to_string(),
            outcome: QueueCompletionOutcome::Succeeded,
            error_summary: None,
            response_fingerprint: Some("response:v1".to_string()),
            retry_jitter_micros: 0,
        },
    )?;

    let job = ctx
        .db
        .queue_job()
        .id()
        .find(&job_id)
        .ok_or("completed queue job disappeared")?;
    assert_eq!(job.status, QueueJobStatus::Completed);
    assert_eq!(job.revision, 2);
    assert_eq!(
        ctx.db
            .queue_effect_receipt()
            .queue_effect_receipt_by_job()
            .filter(&job_id)
            .count(),
        1
    );
    assert_eq!(
        ctx.db
            .queue_attempt()
            .queue_attempt_by_job()
            .filter(&job_id)
            .count(),
        2
    );
    Ok(())
}

/// Covers expired reclaim, stale completion, backoff, dead-letter retry and cancellation.
#[spacetimedb::reducer]
pub fn test_queue_job_edge_cases(ctx: &ReducerContext) -> Result<(), String> {
    let organization_id = create_test_organization(ctx, "QUEUE_EDGE_FINAL", "Queue Edge Final")?;
    let worker_a = register_test_worker(ctx, organization_id, "worker-a", "test")?;
    let worker_b = register_test_worker(ctx, organization_id, "worker-b", "test")?;

    let reclaimed_job_id = enqueue_test_job(ctx, organization_id, "semantic:reclaim", "{}", 3)?;
    claim_queue_job(
        ctx,
        organization_id,
        reclaimed_job_id,
        claim_params(ctx, 0, worker_a, "expired-token"),
    )?;
    let leased = ctx
        .db
        .queue_job()
        .id()
        .find(&reclaimed_job_id)
        .ok_or("leased job disappeared")?;
    ctx.db
        .queue_job()
        .id()
        .update(crate::core::queue::QueueJob {
            lease_expires_at: Some(ctx.timestamp - Duration::from_secs(1)),
            ..leased
        });
    claim_queue_job(
        ctx,
        organization_id,
        reclaimed_job_id,
        claim_params(ctx, 1, worker_b, "replacement-token"),
    )?;
    let reclaimed = ctx
        .db
        .queue_job()
        .id()
        .find(&reclaimed_job_id)
        .ok_or("reclaimed job disappeared")?;
    assert_eq!(reclaimed.attempt_count, 2);
    assert_eq!(reclaimed.lease_worker_id, Some(worker_b));
    assert!(ctx
        .db
        .queue_attempt()
        .queue_attempt_by_job()
        .filter(&reclaimed_job_id)
        .any(|attempt| attempt.outcome == QueueAttemptOutcome::LeaseExpired));
    let stale_completion = complete_queue_job(
        ctx,
        organization_id,
        reclaimed_job_id,
        CompleteQueueJobParams {
            expected_revision: 1,
            worker_id: worker_a,
            lease_token: "expired-token".to_string(),
            outcome: QueueCompletionOutcome::Succeeded,
            error_summary: None,
            response_fingerprint: Some("stale".to_string()),
            retry_jitter_micros: 0,
        },
    );
    assert!(
        stale_completion.is_err(),
        "stale lease completion succeeded"
    );

    let dead_job_id = enqueue_test_job(ctx, organization_id, "semantic:dead", "{}", 1)?;
    claim_queue_job(
        ctx,
        organization_id,
        dead_job_id,
        claim_params(ctx, 0, worker_a, "dead-token"),
    )?;
    complete_queue_job(
        ctx,
        organization_id,
        dead_job_id,
        CompleteQueueJobParams {
            expected_revision: 1,
            worker_id: worker_a,
            lease_token: "dead-token".to_string(),
            outcome: QueueCompletionOutcome::Failed,
            error_summary: Some("provider unavailable".to_string()),
            response_fingerprint: None,
            retry_jitter_micros: 500,
        },
    )?;
    let dead = ctx
        .db
        .queue_job()
        .id()
        .find(&dead_job_id)
        .ok_or("dead-lettered job disappeared")?;
    assert_eq!(dead.status, QueueJobStatus::DeadLettered);
    assert!(dead.dead_lettered_at.is_some());

    retry_dead_letter_queue_job(
        ctx,
        organization_id,
        dead_job_id,
        RetryDeadLetterJobParams {
            expected_revision: dead.revision,
            available_at_micros: None,
            additional_attempts: 1,
            reason: "operator approved retry".to_string(),
        },
    )?;
    let retried = ctx
        .db
        .queue_job()
        .id()
        .find(&dead_job_id)
        .ok_or("retried job disappeared")?;
    assert_eq!(retried.status, QueueJobStatus::Pending);
    assert_eq!(retried.max_attempts, 2);

    cancel_queue_job(
        ctx,
        organization_id,
        dead_job_id,
        CancelQueueJobParams {
            expected_revision: retried.revision,
            reason: "work no longer required".to_string(),
        },
    )?;
    let cancelled = ctx
        .db
        .queue_job()
        .id()
        .find(&dead_job_id)
        .ok_or("cancelled job disappeared")?;
    assert_eq!(cancelled.status, QueueJobStatus::Cancelled);
    assert_eq!(
        cancelled.cancellation_reason.as_deref(),
        Some("work no longer required")
    );
    assert!(cancelled.cancelled_by.is_some());
    Ok(())
}

/// Covers worker validation, scoping and heartbeat evidence.
#[spacetimedb::reducer]
pub fn test_worker_edge_cases(ctx: &ReducerContext) -> Result<(), String> {
    let organization_id =
        create_test_organization(ctx, "QUEUE_WORKER_FINAL", "Queue Worker Final")?;
    let empty_registration = register_queue_worker(
        ctx,
        organization_id,
        RegisterQueueWorkerParams {
            company_id: None,
            name: "invalid-worker".to_string(),
            queues: Vec::new(),
            metadata: None,
        },
    );
    assert!(
        empty_registration.is_err(),
        "worker without a queue was accepted"
    );

    let worker_id = register_test_worker(ctx, organization_id, "worker", "test")?;
    worker_heartbeat(ctx, organization_id, worker_id)?;
    let worker = ctx
        .db
        .queue_worker()
        .id()
        .find(&worker_id)
        .ok_or("worker disappeared after heartbeat")?;
    assert_eq!(worker.organization_id, organization_id);
    assert!(worker.is_active);
    assert!(worker.last_heartbeat >= worker.started_at);
    Ok(())
}

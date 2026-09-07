//! Validated authority contexts for interactive and scheduled owner reports.
//!
//! The constructors in this module are the trust boundary for shared report
//! generation.  HTTP callers must bring a resolved [`ApiSession`] and the
//! client created from that session token.  Scheduled callers must bring a
//! claimed queue job together with facts reloaded from its run and schedule;
//! payload strings alone are not sufficient to create scheduled authority.

use std::str::FromStr;

use stdb_auth::FieldAccessContext;
use stdb_client::StdbClient;

use crate::{
    error::ApiError,
    reports::{common::ReportKey, timezone::parse_timezone},
    session::ApiSession,
};

/// Queue evidence after a worker has claimed an owner-report job.
///
/// Fields stay private so a future worker adapter must use the validating
/// constructor rather than assembling authority from an arbitrary payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ClaimedOwnerReportJob {
    organization_id: u64,
    company_id: u64,
    queue_job_id: u64,
    scheduled_report_run_id: u64,
    scheduled_report_id: u64,
    report_key: ReportKey,
    timezone: String,
    worker_identity: String,
}

impl ClaimedOwnerReportJob {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        organization_id: u64,
        company_id: Option<u64>,
        queue_job_id: u64,
        scheduled_report_run_id: u64,
        scheduled_report_id: u64,
        expected_revision: u64,
        worker_id: u64,
        lease_token: impl Into<String>,
        lease_expires_at_micros: u64,
        report_key: impl Into<String>,
        timezone: impl Into<String>,
        worker_identity: impl Into<String>,
    ) -> Result<Self, ApiError> {
        let company_id = require_company(company_id)?;
        require_nonempty(lease_token.into(), "lease token")?;
        let report_key = require_report_key(report_key.into())?;
        let timezone = require_timezone(timezone.into())?;
        let worker_identity = require_nonempty(worker_identity.into(), "worker identity")?;

        require_nonzero(organization_id, "organization id")?;
        require_nonzero(queue_job_id, "queue job id")?;
        require_nonzero(scheduled_report_run_id, "scheduled report run id")?;
        require_nonzero(scheduled_report_id, "scheduled report id")?;
        require_nonzero(expected_revision, "queue job revision")?;
        require_nonzero(worker_id, "worker id")?;
        require_nonzero(lease_expires_at_micros, "lease expiry")?;

        Ok(Self {
            organization_id,
            company_id,
            queue_job_id,
            scheduled_report_run_id,
            scheduled_report_id,
            report_key,
            timezone,
            worker_identity,
        })
    }

    pub(crate) fn organization_id(&self) -> u64 {
        self.organization_id
    }

    pub(crate) fn company_id(&self) -> u64 {
        self.company_id
    }

    pub(crate) fn queue_job_id(&self) -> u64 {
        self.queue_job_id
    }

    pub(crate) fn scheduled_report_run_id(&self) -> u64 {
        self.scheduled_report_run_id
    }

    pub(crate) fn scheduled_report_id(&self) -> u64 {
        self.scheduled_report_id
    }

    pub(crate) fn report_key(&self) -> ReportKey {
        self.report_key
    }

    pub(crate) fn timezone(&self) -> &str {
        &self.timezone
    }
}

/// Facts reloaded from `scheduled_report_run` after a queue job is claimed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScheduledReportRunFacts {
    organization_id: u64,
    run_id: u64,
    scheduled_report_id: u64,
    queue_job_id: u64,
}

impl ScheduledReportRunFacts {
    pub(crate) fn new(
        organization_id: u64,
        run_id: u64,
        scheduled_report_id: u64,
        queue_job_id: Option<u64>,
        status: impl Into<String>,
    ) -> Result<Self, ApiError> {
        require_nonzero(organization_id, "run organization id")?;
        require_nonzero(run_id, "run id")?;
        require_nonzero(scheduled_report_id, "run scheduled report id")?;
        let queue_job_id = queue_job_id
            .ok_or_else(|| invalid_context("scheduled report run is not bound to a queue job"))?;
        require_nonzero(queue_job_id, "run queue job id")?;
        let status = require_nonempty(status.into(), "run status")?;
        if !matches!(status.as_str(), "queued" | "failed") {
            return Err(invalid_context(
                "scheduled report run status must be queued or failed",
            ));
        }

        Ok(Self {
            organization_id,
            run_id,
            scheduled_report_id,
            queue_job_id,
        })
    }

    pub(crate) fn organization_id(&self) -> u64 {
        self.organization_id
    }

    pub(crate) fn run_id(&self) -> u64 {
        self.run_id
    }

    pub(crate) fn scheduled_report_id(&self) -> u64 {
        self.scheduled_report_id
    }

    pub(crate) fn queue_job_id(&self) -> u64 {
        self.queue_job_id
    }
}

/// Facts reloaded from the owner-report `scheduled_report` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScheduledOwnerReportFacts {
    organization_id: u64,
    scheduled_report_id: u64,
    company_id: u64,
    report_key: ReportKey,
    timezone: String,
}

impl ScheduledOwnerReportFacts {
    pub(crate) fn new(
        organization_id: u64,
        scheduled_report_id: u64,
        company_id: Option<u64>,
        report_key: Option<String>,
        timezone: Option<String>,
    ) -> Result<Self, ApiError> {
        require_nonzero(organization_id, "schedule organization id")?;
        require_nonzero(scheduled_report_id, "schedule id")?;
        let company_id = require_company(company_id)?;
        let report_key = report_key
            .ok_or_else(|| invalid_context("schedule has no owner report key"))
            .and_then(require_report_key)?;
        let timezone = timezone
            .ok_or_else(|| invalid_context("schedule has no timezone"))
            .and_then(require_timezone)?;

        Ok(Self {
            organization_id,
            scheduled_report_id,
            company_id,
            report_key,
            timezone,
        })
    }

    pub(crate) fn organization_id(&self) -> u64 {
        self.organization_id
    }

    pub(crate) fn scheduled_report_id(&self) -> u64 {
        self.scheduled_report_id
    }

    pub(crate) fn company_id(&self) -> u64 {
        self.company_id
    }

    pub(crate) fn report_key(&self) -> ReportKey {
        self.report_key
    }

    pub(crate) fn timezone(&self) -> &str {
        &self.timezone
    }
}

/// Authority for an interactive request resolved from an authenticated user session.
pub(crate) struct InteractiveReportContext {
    client: StdbClient,
    organization_id: u64,
    actor_identity: String,
    field_access: Option<FieldAccessContext>,
}

impl InteractiveReportContext {
    /// Construct only from a resolved session and the client carrying its token.
    pub(crate) fn from_session(session: ApiSession, client: StdbClient) -> Result<Self, ApiError> {
        let organization_id = session
            .organization_id
            .ok_or_else(|| ApiError::Forbidden("report session has no organization".into()))?;
        require_nonzero(organization_id, "session organization id")?;
        let actor_identity = require_nonempty(session.identity_hex, "actor identity")?;
        let session_token = require_nonempty(session.stdb_token, "session token")?;
        if client.token() != session_token {
            return Err(invalid_context(
                "interactive client token does not match the resolved session",
            ));
        }
        if let Some(field_access) = session.field_access.as_ref() {
            if field_access.organization_id != organization_id {
                return Err(invalid_context(
                    "field-access organization does not match the session",
                ));
            }
            if !field_access
                .identity_hex
                .trim_start_matches("0x")
                .eq_ignore_ascii_case(actor_identity.trim_start_matches("0x"))
            {
                return Err(invalid_context(
                    "field-access identity does not match the session",
                ));
            }
        }

        Ok(Self {
            client,
            organization_id,
            actor_identity,
            field_access: session.field_access,
        })
    }

    pub(crate) fn client(&self) -> &StdbClient {
        &self.client
    }

    pub(crate) fn organization_id(&self) -> u64 {
        self.organization_id
    }

    pub(crate) fn actor_identity(&self) -> &str {
        &self.actor_identity
    }

    pub(crate) fn field_access(&self) -> Option<&FieldAccessContext> {
        self.field_access.as_ref()
    }
}

/// Authority for a scheduled report after queue, run, and schedule facts agree.
///
/// `worker_identity` is an opaque service provenance value.  It is never copied
/// into `actor_identity` and cannot impersonate an interactive user.
pub(crate) struct ScheduledReportContext {
    client: StdbClient,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    report_key: ReportKey,
    timezone: String,
    worker_identity: String,
}

impl ScheduledReportContext {
    pub(crate) fn from_claimed_job(
        server_client: StdbClient,
        claimed_job: ClaimedOwnerReportJob,
        run: ScheduledReportRunFacts,
        schedule: ScheduledOwnerReportFacts,
    ) -> Result<Self, ApiError> {
        if server_client.token().trim().is_empty() {
            return Err(invalid_context(
                "scheduled context requires a server client token",
            ));
        }
        require_same(
            "organization",
            claimed_job.organization_id(),
            run.organization_id(),
        )?;
        require_same(
            "organization",
            claimed_job.organization_id(),
            schedule.organization_id(),
        )?;
        require_same("run", claimed_job.scheduled_report_run_id(), run.run_id())?;
        require_same(
            "schedule",
            claimed_job.scheduled_report_id(),
            run.scheduled_report_id(),
        )?;
        require_same(
            "schedule",
            claimed_job.scheduled_report_id(),
            schedule.scheduled_report_id(),
        )?;
        require_same("queue job", claimed_job.queue_job_id(), run.queue_job_id())?;
        require_same("company", claimed_job.company_id(), schedule.company_id())?;
        require_same(
            "report key",
            claimed_job.report_key(),
            schedule.report_key(),
        )?;
        require_same("timezone", claimed_job.timezone(), schedule.timezone())?;

        let organization_id = claimed_job.organization_id();
        let company_id = claimed_job.company_id();
        let run_id = claimed_job.scheduled_report_run_id();
        let report_key = claimed_job.report_key;
        let timezone = claimed_job.timezone;
        let worker_identity = claimed_job.worker_identity;

        Ok(Self {
            client: server_client,
            organization_id,
            company_id,
            run_id,
            report_key,
            timezone,
            worker_identity,
        })
    }

    pub(crate) fn client(&self) -> &StdbClient {
        &self.client
    }

    pub(crate) fn organization_id(&self) -> u64 {
        self.organization_id
    }

    pub(crate) fn company_id(&self) -> u64 {
        self.company_id
    }

    pub(crate) fn run_id(&self) -> u64 {
        self.run_id
    }
    pub(crate) fn report_key(&self) -> ReportKey {
        self.report_key
    }

    pub(crate) fn timezone(&self) -> &str {
        &self.timezone
    }

    pub(crate) fn worker_identity(&self) -> &str {
        &self.worker_identity
    }
}

fn invalid_context(message: &str) -> ApiError {
    ApiError::BadRequest(format!("invalid report execution context: {message}"))
}

fn require_nonzero(value: u64, field: &str) -> Result<(), ApiError> {
    if value == 0 {
        Err(invalid_context(&format!(
            "{field} must be greater than zero"
        )))
    } else {
        Ok(())
    }
}

fn require_nonempty(value: String, field: &str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        Err(invalid_context(&format!("{field} must not be blank")))
    } else {
        Ok(value.to_string())
    }
}

fn require_company(company_id: Option<u64>) -> Result<u64, ApiError> {
    let company_id = company_id.ok_or_else(|| invalid_context("company id is required"))?;
    require_nonzero(company_id, "company id")?;
    Ok(company_id)
}

fn require_report_key(value: String) -> Result<ReportKey, ApiError> {
    let value = require_nonempty(value, "report key")?;
    ReportKey::from_str(&value)
        .map_err(|_| invalid_context("report key is not in the owner-report catalog"))
}

fn require_timezone(value: String) -> Result<String, ApiError> {
    let value = require_nonempty(value, "timezone")?;
    parse_timezone(&value)?;
    Ok(value)
}

fn require_same<T: PartialEq + std::fmt::Display>(
    field: &str,
    left: T,
    right: T,
) -> Result<(), ApiError> {
    if left == right {
        Ok(())
    } else {
        Err(invalid_context(&format!("{field} evidence does not match")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "session-token";
    const IDENTITY: &str = "actor-identity";
    const REPORT_KEY: &str = "daily_business_summary_v1";
    const TIMEZONE: &str = "UTC";

    fn client(token: &str) -> StdbClient {
        StdbClient::new(
            "http://localhost:3000".into(),
            "lumiere-test".into(),
            token.into(),
        )
    }

    fn session(organization_id: Option<u64>, token: &str, identity: &str) -> ApiSession {
        ApiSession {
            stdb_token: token.into(),
            identity_hex: identity.into(),
            organization_id,
            field_access: None,
        }
    }

    fn claimed() -> ClaimedOwnerReportJob {
        ClaimedOwnerReportJob::new(
            7,
            Some(11),
            101,
            202,
            303,
            4,
            505,
            "lease-token",
            9_999,
            REPORT_KEY,
            TIMEZONE,
            "owner-report-worker",
        )
        .expect("valid claimed job")
    }

    fn run_facts() -> ScheduledReportRunFacts {
        ScheduledReportRunFacts::new(7, 202, 303, Some(101), "queued").expect("valid run facts")
    }

    fn schedule_facts() -> ScheduledOwnerReportFacts {
        ScheduledOwnerReportFacts::new(
            7,
            303,
            Some(11),
            Some(REPORT_KEY.into()),
            Some(TIMEZONE.into()),
        )
        .expect("valid schedule facts")
    }

    #[test]
    fn interactive_context_requires_session_org_and_matching_token() {
        let context = InteractiveReportContext::from_session(
            session(Some(7), TOKEN, IDENTITY),
            client(TOKEN),
        )
        .expect("valid interactive context");
        assert_eq!(context.organization_id(), 7);
        assert_eq!(context.actor_identity(), IDENTITY);
        assert!(context.field_access().is_none());

        for (session, context_client) in [
            (session(None, TOKEN, IDENTITY), client(TOKEN)),
            (session(Some(0), TOKEN, IDENTITY), client(TOKEN)),
            (session(Some(7), TOKEN, ""), client(TOKEN)),
            (session(Some(7), "", IDENTITY), client(TOKEN)),
            (session(Some(7), TOKEN, IDENTITY), client("other-token")),
        ] {
            assert!(
                InteractiveReportContext::from_session(session, context_client).is_err(),
                "invalid interactive authority must be rejected"
            );
        }
    }

    #[test]
    fn scheduled_context_accepts_matching_claimed_run_and_schedule() {
        let context = ScheduledReportContext::from_claimed_job(
            client("server-token"),
            claimed(),
            run_facts(),
            schedule_facts(),
        )
        .expect("valid scheduled context");
        assert_eq!(context.organization_id(), 7);
        assert_eq!(context.company_id(), 11);
        assert_eq!(context.run_id(), 202);
        assert_eq!(context.report_key().as_str(), REPORT_KEY);
        assert_eq!(context.timezone(), TIMEZONE);
        assert_eq!(context.worker_identity(), "owner-report-worker");
    }

    #[test]
    fn scheduled_context_rejects_each_cross_boundary_mismatch() {
        let mut cases = Vec::new();

        let mut mismatched_run = run_facts();
        mismatched_run.organization_id = 8;
        cases.push(("organization", claimed(), mismatched_run, schedule_facts()));

        let mut mismatched_schedule = schedule_facts();
        mismatched_schedule.company_id = 12;
        cases.push(("company", claimed(), run_facts(), mismatched_schedule));

        let mut mismatched_job = claimed();
        mismatched_job.queue_job_id = 999;
        cases.push(("job", mismatched_job, run_facts(), schedule_facts()));

        let mut mismatched_job = claimed();
        mismatched_job.scheduled_report_run_id = 999;
        cases.push(("run", mismatched_job, run_facts(), schedule_facts()));

        let mut mismatched_job = claimed();
        mismatched_job.scheduled_report_id = 999;
        cases.push(("schedule", mismatched_job, run_facts(), schedule_facts()));

        let mut mismatched_schedule = schedule_facts();
        mismatched_schedule.report_key = ReportKey::CashMobileMoneyV1;
        cases.push(("report key", claimed(), run_facts(), mismatched_schedule));

        let mut mismatched_schedule = schedule_facts();
        mismatched_schedule.timezone = "Africa/Nairobi".into();
        cases.push(("timezone", claimed(), run_facts(), mismatched_schedule));

        for (label, job, run, schedule) in cases {
            assert!(
                ScheduledReportContext::from_claimed_job(
                    client("server-token"),
                    job,
                    run,
                    schedule
                )
                .is_err(),
                "{label} mismatch must be rejected"
            );
        }
    }

    #[test]
    fn scheduled_evidence_rejects_invalid_zero_blank_and_missing_values() {
        assert!(ClaimedOwnerReportJob::new(
            0,
            Some(11),
            101,
            202,
            303,
            4,
            505,
            "lease",
            9_999,
            REPORT_KEY,
            TIMEZONE,
            "worker",
        )
        .is_err());
        assert!(ClaimedOwnerReportJob::new(
            7,
            Some(0),
            101,
            202,
            303,
            4,
            505,
            "lease",
            9_999,
            REPORT_KEY,
            TIMEZONE,
            "worker",
        )
        .is_err());
        assert!(ClaimedOwnerReportJob::new(
            7,
            Some(11),
            0,
            202,
            303,
            4,
            505,
            "lease",
            9_999,
            REPORT_KEY,
            TIMEZONE,
            "worker",
        )
        .is_err());
        assert!(ClaimedOwnerReportJob::new(
            7,
            Some(11),
            101,
            202,
            303,
            4,
            505,
            "lease",
            9_999,
            REPORT_KEY,
            TIMEZONE,
            "",
        )
        .is_err());
        assert!(ClaimedOwnerReportJob::new(
            7,
            Some(11),
            101,
            202,
            303,
            4,
            505,
            "lease",
            9_999,
            REPORT_KEY,
            "Not/A_Real_Zone",
            "worker",
        )
        .is_err());
        assert!(ScheduledReportRunFacts::new(7, 202, 303, None, "queued").is_err());
        assert!(
            ScheduledOwnerReportFacts::new(7, 303, Some(11), None, Some(TIMEZONE.into())).is_err()
        );
        assert!(
            ScheduledOwnerReportFacts::new(7, 303, Some(11), Some(REPORT_KEY.into()), None)
                .is_err()
        );
    }
}

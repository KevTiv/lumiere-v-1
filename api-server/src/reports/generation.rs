//! Shared preview, rendering, and persistence sequence for owner reports.

use crate::{
    error::ApiError,
    reports::{
        artifacts::{record_generated_report, RecordedOwnerReport},
        auth::{ensure_report_access, mask_report_preview, ReportAccess},
        common::{ReportKey, ReportPreviewRequest},
        execution_context::{InteractiveReportContext, ScheduledReportContext},
        render::render_pdf,
        service::preview_report,
    },
    state::AppState,
};

/// Validated authority for one shared owner-report generation.
///
/// The variants are private so callers must use the narrow constructors and
/// cannot assemble privileged authority from unchecked request fields.
pub(crate) enum ReportExecutionContext {
    Interactive(InteractiveReportContext),
    Scheduled(ScheduledReportContext),
}

impl ReportExecutionContext {
    pub(crate) fn interactive(context: InteractiveReportContext) -> Self {
        Self::Interactive(context)
    }

    pub(crate) fn scheduled(context: ScheduledReportContext) -> Self {
        Self::Scheduled(context)
    }
}

#[derive(Debug)]
pub(crate) struct GeneratedOwnerReport {
    pub(crate) pdf: Vec<u8>,
    pub(crate) artifact: RecordedOwnerReport,
}

pub(crate) async fn generate_owner_report(
    state: &AppState,
    context: ReportExecutionContext,
    report_key: ReportKey,
    request: ReportPreviewRequest,
) -> Result<GeneratedOwnerReport, ApiError> {
    let (preview, client, organization_id, correlation_suffix) = match context {
        ReportExecutionContext::Interactive(context) => {
            ensure_report_access(context.field_access(), report_key, ReportAccess::Export)?;
            let client = context.client().clone();
            let organization_id = context.organization_id();
            let preview = preview_report(
                &client,
                report_key,
                organization_id,
                context.actor_identity(),
                request,
            )
            .await?;
            let preview = mask_report_preview(preview, context.field_access());
            (preview, client, organization_id, None)
        }
        ReportExecutionContext::Scheduled(context) => {
            validate_scheduled_request(&context, report_key, &request)?;
            let client = context.client().clone();
            let organization_id = context.organization_id();
            let preview = preview_report(
                &client,
                report_key,
                organization_id,
                context.worker_identity(),
                request,
            )
            .await?;
            let correlation_suffix = scheduled_correlation_suffix(context.run_id());
            (preview, client, organization_id, Some(correlation_suffix))
        }
    };

    let pdf = render_pdf(state, &preview).await?;
    let artifact = record_generated_report(
        state,
        &client,
        organization_id,
        &preview,
        &pdf,
        correlation_suffix.as_deref(),
    )
    .await?;

    Ok(GeneratedOwnerReport { pdf, artifact })
}

fn validate_scheduled_request(
    context: &ScheduledReportContext,
    report_key: ReportKey,
    request: &ReportPreviewRequest,
) -> Result<(), ApiError> {
    let context_report_key = context.report_key();
    if context_report_key != report_key {
        return Err(invalid_scheduled_request(
            "request report key does not match scheduled context",
        ));
    }
    if request.company_id != context.company_id() {
        return Err(invalid_scheduled_request(
            "request company does not match scheduled context",
        ));
    }
    if request.timezone.trim() != context.timezone() {
        return Err(invalid_scheduled_request(
            "request timezone does not match scheduled context",
        ));
    }
    Ok(())
}

fn invalid_scheduled_request(message: &str) -> ApiError {
    ApiError::BadRequest(format!("invalid scheduled report request: {message}"))
}

fn scheduled_correlation_suffix(run_id: u64) -> String {
    format!("scheduled-run-{run_id}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reports::execution_context::{
        ClaimedOwnerReportJob, ScheduledOwnerReportFacts, ScheduledReportRunFacts,
    };
    use stdb_client::StdbClient;

    fn scheduled_context() -> ScheduledReportContext {
        let claimed = ClaimedOwnerReportJob::new(
            7,
            Some(11),
            101,
            202,
            303,
            4,
            505,
            "lease-token",
            9_999,
            "daily_business_summary_v1",
            "UTC",
            "owner-report-worker",
        )
        .expect("valid claimed job");
        let run = ScheduledReportRunFacts::new(7, 202, 303, Some(101), "queued")
            .expect("valid run facts");
        let schedule = ScheduledOwnerReportFacts::new(
            7,
            303,
            Some(11),
            Some("daily_business_summary_v1".into()),
            Some("UTC".into()),
        )
        .expect("valid schedule facts");
        ScheduledReportContext::from_claimed_job(
            StdbClient::new(
                "http://localhost:3000".into(),
                "lumiere-test".into(),
                "server-token".into(),
            ),
            claimed,
            run,
            schedule,
        )
        .expect("valid scheduled context")
    }

    fn request() -> ReportPreviewRequest {
        ReportPreviewRequest {
            company_id: 11,
            date: "2026-07-10".into(),
            timezone: "UTC".into(),
        }
    }

    #[test]
    fn scheduled_request_must_match_context_key_company_and_timezone() {
        let context = scheduled_context();
        assert!(validate_scheduled_request(
            &context,
            ReportKey::DailyBusinessSummaryV1,
            &request()
        )
        .is_ok());
        assert!(
            validate_scheduled_request(&context, ReportKey::CashMobileMoneyV1, &request()).is_err()
        );

        let mut wrong_company = request();
        wrong_company.company_id = 12;
        assert!(validate_scheduled_request(
            &context,
            ReportKey::DailyBusinessSummaryV1,
            &wrong_company
        )
        .is_err());

        let mut wrong_timezone = request();
        wrong_timezone.timezone = "Africa/Nairobi".into();
        assert!(validate_scheduled_request(
            &context,
            ReportKey::DailyBusinessSummaryV1,
            &wrong_timezone
        )
        .is_err());
    }

    #[test]
    fn scheduled_correlation_uses_run_identity() {
        assert_eq!(scheduled_correlation_suffix(202), "scheduled-run-202");
    }
}

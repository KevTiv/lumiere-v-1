//! As-of farm metrics derived from resolved domain events and verified input coverage.

use chrono::NaiveDate;
use serde::Serialize;

use super::model::{live_headcount, EventInput, EventKind};

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(super) enum Metric<T> {
    Available { value: T },
    Unavailable { reason: MissingInput },
}

impl<T> From<Result<T, MissingInput>> for Metric<T> {
    fn from(result: Result<T, MissingInput>) -> Self {
        match result {
            Ok(value) => Self::Available { value },
            Err(reason) => Self::Unavailable { reason },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum MissingInput {
    MissingIntake,
    InvalidHeadcount,
    IncompleteMortalityCohort,
    MissingWeighIns,
    AmbiguousWeighIns,
    ChangedWeighInCohort,
    MissingWholeFlockWeights,
    MissingFeedCoverage,
    MissingFeedConsumption,
    NonpositiveWeightGain,
    NoProcessing,
    MissingProcessingWeight,
    NonpositiveWeight,
    MissingRecognizedCosts,
    MissingTraceableSales,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Metrics {
    as_of: String,
    live_headcount: Metric<u64>,
    recorded_deaths: u64,
    mortality_rate: Metric<f64>,
    average_daily_gain_kg: Metric<f64>,
    growth_window: Option<GrowthWindow>,
    feed_conversion_ratio: Metric<f64>,
    processing_live_input_kg: Metric<f64>,
    processing_sellable_output_kg: Metric<f64>,
    processing_yield: Metric<f64>,
    cost_per_sellable_kg: Metric<CostPerWeight>,
    margin: Metric<Margin>,
}

/// Totals are supplied only when the accounting readback can prove the matching basis.
/// Monetary fields are minor units in a single company currency.
pub(super) struct FinancialSnapshot {
    pub(super) through: NaiveDate,
    pub(super) currency: String,
    pub(super) minor_unit_digits: u8,
    pub(super) allocated_cost_minor: Option<i128>,
    pub(super) costed_output_kg: Option<f64>,
    pub(super) net_sales_minor: Option<i128>,
    pub(super) cost_of_goods_sold_minor: Option<i128>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct CostPerWeight {
    currency: String,
    minor_unit_digits: u8,
    amount_minor_per_kg: f64,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Margin {
    currency: String,
    minor_unit_digits: u8,
    net_sales_minor: String,
    cost_of_goods_sold_minor: String,
    amount_minor: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GrowthWindow {
    opening_date: String,
    closing_date: String,
    opening_sample_count: u32,
    closing_sample_count: u32,
    opening_mean_weight_kg: f64,
    closing_mean_weight_kg: f64,
}

pub(super) fn compute(
    events: &[EventInput],
    as_of: NaiveDate,
    financial: Option<&FinancialSnapshot>,
) -> Metrics {
    let scoped: Vec<_> = events
        .iter()
        .filter(|event| event.business_date <= as_of)
        .collect();
    let admitted: u64 = scoped
        .iter()
        .filter_map(|event| match event.kind {
            EventKind::Intake { count, .. } => Some(u64::from(count)),
            _ => None,
        })
        .sum();
    let recorded_deaths: u64 = scoped
        .iter()
        .filter_map(|event| match event.kind {
            EventKind::Mortality { count, .. } => Some(u64::from(count)),
            _ => None,
        })
        .sum();
    let has_transfer_in = scoped
        .iter()
        .any(|event| matches!(event.kind, EventKind::TransferIn { .. }));
    let headcount = if admitted == 0 && !has_transfer_in {
        Err(MissingInput::MissingIntake)
    } else {
        live_headcount(events, Some(as_of)).map_err(|_| MissingInput::InvalidHeadcount)
    };
    let mortality = headcount.and_then(|_| {
        if has_transfer_in
            || scoped.iter().any(|event| {
                matches!(
                    event.kind,
                    EventKind::TransferOut { .. } | EventKind::LiveSale { .. }
                )
            })
        {
            Err(MissingInput::IncompleteMortalityCohort)
        } else {
            Ok(recorded_deaths as f64 / admitted as f64)
        }
    });
    let interval = headcount.and_then(|_| weigh_in_interval(events, &scoped));
    let daily_gain = interval.map(|interval| {
        (interval.closing.mean() - interval.opening.mean())
            / (interval.closing.date - interval.opening.date).num_days() as f64
    });
    let feed_conversion = interval.and_then(|interval| feed_conversion(&scoped, interval));
    let (input_kg, output_kg) = processing_weights(&scoped);
    let processing_yield =
        input_kg.and_then(|input| output_kg.and_then(|output| ratio(output, input)));
    let verified_financial = financial.filter(|snapshot| {
        snapshot.through == as_of
            && !snapshot.currency.is_empty()
            && snapshot.minor_unit_digits <= 9
    });
    Metrics {
        as_of: as_of.to_string(),
        live_headcount: headcount.into(),
        recorded_deaths,
        mortality_rate: mortality.into(),
        average_daily_gain_kg: daily_gain.into(),
        growth_window: interval.ok().map(|interval| GrowthWindow {
            opening_date: interval.opening.date.to_string(),
            closing_date: interval.closing.date.to_string(),
            opening_sample_count: interval.opening.sample_count,
            closing_sample_count: interval.closing.sample_count,
            opening_mean_weight_kg: interval.opening.mean(),
            closing_mean_weight_kg: interval.closing.mean(),
        }),
        feed_conversion_ratio: feed_conversion.into(),
        processing_live_input_kg: input_kg.into(),
        processing_sellable_output_kg: output_kg.into(),
        processing_yield: processing_yield.into(),
        cost_per_sellable_kg: cost_per_kg(verified_financial, output_kg).into(),
        margin: margin(verified_financial).into(),
    }
}

#[derive(Clone, Copy)]
struct WeighIn {
    date: NaiveDate,
    sample_count: u32,
    weight_kg: f64,
}

impl WeighIn {
    fn mean(self) -> f64 {
        self.weight_kg / f64::from(self.sample_count)
    }
}

#[derive(Clone, Copy)]
struct GrowthInterval {
    opening: WeighIn,
    closing: WeighIn,
    headcount: u64,
}

fn weigh_in_interval(
    events: &[EventInput],
    scoped: &[&EventInput],
) -> Result<GrowthInterval, MissingInput> {
    let samples: Vec<_> = scoped
        .iter()
        .filter_map(|event| match event.kind {
            EventKind::WeighIn {
                sample_count,
                total_weight_kg,
                ..
            } => Some(WeighIn {
                date: event.business_date,
                sample_count,
                weight_kg: total_weight_kg,
            }),
            _ => None,
        })
        .collect();
    let opening = samples
        .iter()
        .min_by_key(|sample| sample.date)
        .ok_or(MissingInput::MissingWeighIns)?;
    let closing = samples
        .iter()
        .max_by_key(|sample| sample.date)
        .filter(|closing| closing.date != opening.date)
        .ok_or(MissingInput::MissingWeighIns)?;
    if [opening, closing].into_iter().any(|end| {
        end.sample_count == 0
            || !end.weight_kg.is_finite()
            || end.weight_kg <= 0.0
            || samples
                .iter()
                .filter(|sample| sample.date == end.date)
                .count()
                != 1
    }) {
        return Err(MissingInput::AmbiguousWeighIns);
    }
    if scoped.iter().any(|event| {
        opening.date < event.business_date
            && event.business_date <= closing.date
            && matches!(
                event.kind,
                EventKind::Intake { .. }
                    | EventKind::TransferIn { .. }
                    | EventKind::TransferOut { .. }
                    | EventKind::LiveSale { .. }
                    | EventKind::Processing { .. }
            )
    }) {
        return Err(MissingInput::ChangedWeighInCohort);
    }
    let headcount =
        live_headcount(events, Some(opening.date)).map_err(|_| MissingInput::InvalidHeadcount)?;
    if headcount == 0 {
        return Err(MissingInput::MissingIntake);
    }
    let closing_headcount =
        live_headcount(events, Some(closing.date)).map_err(|_| MissingInput::InvalidHeadcount)?;
    if u64::from(opening.sample_count) > headcount
        || u64::from(closing.sample_count) > closing_headcount
    {
        return Err(MissingInput::AmbiguousWeighIns);
    }
    Ok(GrowthInterval {
        opening: *opening,
        closing: *closing,
        headcount,
    })
}

fn feed_conversion(scoped: &[&EventInput], interval: GrowthInterval) -> Result<f64, MissingInput> {
    // The starting and closing whole-flock weights alone cannot reconcile biomass lost to deaths.
    if scoped.iter().any(|event| {
        interval.opening.date < event.business_date
            && event.business_date <= interval.closing.date
            && matches!(event.kind, EventKind::Mortality { .. })
    }) {
        return Err(MissingInput::ChangedWeighInCohort);
    }
    if !has_feed_coverage(scoped, interval.opening.date, interval.closing.date) {
        return Err(MissingInput::MissingFeedCoverage);
    }
    if [interval.opening, interval.closing]
        .into_iter()
        .any(|sample| u64::from(sample.sample_count) != interval.headcount)
    {
        return Err(MissingInput::MissingWholeFlockWeights);
    }

    let feed_kg = scoped
        .iter()
        .filter_map(|event| match event.kind {
            EventKind::FeedUsage { quantity_kg, .. }
                if interval.opening.date < event.business_date
                    && event.business_date <= interval.closing.date =>
            {
                Some(quantity_kg)
            }
            _ => None,
        })
        .sum::<f64>();
    if !feed_kg.is_finite() || feed_kg <= 0.0 {
        return Err(MissingInput::MissingFeedConsumption);
    }
    let weight_gain_kg = interval.closing.weight_kg - interval.opening.weight_kg;
    ratio(feed_kg, weight_gain_kg).map_err(|_| MissingInput::NonpositiveWeightGain)
}

fn has_feed_coverage(scoped: &[&EventInput], start: NaiveDate, end: NaiveDate) -> bool {
    let mut coverage: Vec<_> = scoped
        .iter()
        .filter_map(|event| match event.kind {
            EventKind::FeedCoverage { from_exclusive, .. } => {
                Some((from_exclusive, event.business_date))
            }
            _ => None,
        })
        .collect();
    coverage.sort_unstable();
    let mut through = start;
    for (from, to) in coverage {
        if from > through {
            break;
        }
        through = through.max(to);
    }
    through >= end
}

fn processing_weights(
    scoped: &[&EventInput],
) -> (Result<f64, MissingInput>, Result<f64, MissingInput>) {
    let mut runs = scoped.iter().filter_map(|event| match event.kind {
        EventKind::Processing {
            live_weight_kg,
            sellable_weight_kg,
            ..
        } => Some((live_weight_kg, sellable_weight_kg)),
        _ => None,
    });
    let Some((input, output)) = runs.next() else {
        return (
            Err(MissingInput::NoProcessing),
            Err(MissingInput::NoProcessing),
        );
    };
    let (input, output) = runs.fold((input, output), |(input, output), (next_in, next_out)| {
        (
            input.zip(next_in).map(|(total, next)| total + next),
            output.zip(next_out).map(|(total, next)| total + next),
        )
    });
    let valid_weight = |weight: Option<f64>| {
        weight
            .filter(|value| value.is_finite() && *value >= 0.0)
            .ok_or(MissingInput::MissingProcessingWeight)
    };
    (valid_weight(input), valid_weight(output))
}

fn ratio(numerator: f64, denominator: f64) -> Result<f64, MissingInput> {
    if denominator <= 0.0 {
        return Err(MissingInput::NonpositiveWeight);
    }
    let value = numerator / denominator;
    if value.is_finite() {
        Ok(value)
    } else {
        Err(MissingInput::NonpositiveWeight)
    }
}

fn cost_per_kg(
    financial: Option<&FinancialSnapshot>,
    sellable_output: Result<f64, MissingInput>,
) -> Result<CostPerWeight, MissingInput> {
    let financial = financial.ok_or(MissingInput::MissingRecognizedCosts)?;
    let cost = financial
        .allocated_cost_minor
        .ok_or(MissingInput::MissingRecognizedCosts)?;
    let output = sellable_output?;
    let costed_output = financial
        .costed_output_kg
        .filter(|weight| (output - weight).abs() <= 0.000_001)
        .ok_or(MissingInput::MissingRecognizedCosts)?;
    let amount = ratio(cost as f64, costed_output)?;
    Ok(CostPerWeight {
        amount_minor_per_kg: amount,
        currency: financial.currency.clone(),
        minor_unit_digits: financial.minor_unit_digits,
    })
}

fn margin(financial: Option<&FinancialSnapshot>) -> Result<Margin, MissingInput> {
    let financial = financial.ok_or(MissingInput::MissingTraceableSales)?;
    let (sales, cost_of_goods) = financial
        .net_sales_minor
        .zip(financial.cost_of_goods_sold_minor)
        .ok_or(MissingInput::MissingTraceableSales)?;
    let amount = sales
        .checked_sub(cost_of_goods)
        .ok_or(MissingInput::MissingTraceableSales)?;
    Ok(Margin {
        currency: financial.currency.clone(),
        minor_unit_digits: financial.minor_unit_digits,
        net_sales_minor: sales.to_string(),
        cost_of_goods_sold_minor: cost_of_goods.to_string(),
        amount_minor: amount.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, day).unwrap()
    }

    fn event(date: u32, kind: EventKind) -> EventInput {
        EventInput {
            business_date: day(date),
            kind,
        }
    }

    fn intake(count: u32) -> EventInput {
        event(1, EventKind::Intake { count })
    }

    fn weigh_in(date: u32, sample_count: u32, total_weight_kg: f64) -> EventInput {
        event(
            date,
            EventKind::WeighIn {
                sample_count,
                total_weight_kg,
            },
        )
    }

    fn feed(date: u32, quantity_kg: f64) -> EventInput {
        event(
            date,
            EventKind::FeedUsage {
                feed_product: "feed".to_owned(),
                quantity_kg,
            },
        )
    }

    fn coverage(start: u32, end: u32) -> EventInput {
        event(
            end,
            EventKind::FeedCoverage {
                from_exclusive: day(start),
            },
        )
    }

    fn processed(
        date: u32,
        count: u32,
        live_weight_kg: Option<f64>,
        sellable_weight_kg: Option<f64>,
    ) -> EventInput {
        event(
            date,
            EventKind::Processing {
                count,
                live_weight_kg,
                sellable_weight_kg,
            },
        )
    }

    #[test]
    fn reads_headcount_mortality_and_processing_yield_as_of_business_date() {
        let events = [
            intake(100),
            event(2, EventKind::Mortality { count: 4 }),
            processed(3, 80, Some(160.0), Some(120.0)),
            processed(10, 16, Some(20.0), Some(5.0)),
        ];
        let first_run = compute(&events, day(3), None);
        assert_eq!(first_run.live_headcount, Metric::Available { value: 16 });
        assert_eq!(first_run.recorded_deaths, 4);
        assert_eq!(first_run.mortality_rate, Metric::Available { value: 0.04 });
        assert_eq!(
            first_run.processing_yield,
            Metric::Available { value: 0.75 }
        );
        let both_runs = compute(&events, day(10), None);
        assert_eq!(both_runs.live_headcount, Metric::Available { value: 0 });
        assert_eq!(
            both_runs.processing_yield,
            Metric::Available {
                value: 125.0 / 180.0
            }
        );
    }

    #[test]
    fn separates_unknown_processing_weight_from_a_measured_zero() {
        let unknown = compute(&[intake(1), processed(2, 1, None, Some(0.0))], day(2), None);
        assert_eq!(
            unknown.processing_sellable_output_kg,
            Metric::Available { value: 0.0 }
        );
        assert_eq!(
            unknown.processing_yield,
            Metric::Unavailable {
                reason: MissingInput::MissingProcessingWeight
            }
        );
        let zero_yield = compute(
            &[intake(1), processed(2, 1, Some(1.0), Some(0.0))],
            day(2),
            None,
        );
        assert_eq!(
            zero_yield.processing_yield,
            Metric::Available { value: 0.0 }
        );
    }

    #[test]
    fn returns_an_incomplete_mortality_cohort_after_external_transfer() {
        let events = [
            intake(100),
            event(2, EventKind::InternalTransfer { count: 15 }),
            event(3, EventKind::TransferOut { count: 15 }),
            event(4, EventKind::Mortality { count: 2 }),
        ];
        let with_internal_transfer = compute(&events, day(2), None);
        assert_eq!(
            with_internal_transfer.mortality_rate,
            Metric::Available { value: 0.0 }
        );
        let with_external_transfer = compute(&events, day(4), None);
        assert_eq!(
            with_external_transfer.live_headcount,
            Metric::Available { value: 83 }
        );
        assert_eq!(with_external_transfer.recorded_deaths, 2);
        assert_eq!(
            with_external_transfer.mortality_rate,
            Metric::Unavailable {
                reason: MissingInput::IncompleteMortalityCohort
            }
        );
    }

    #[test]
    fn a_transfer_can_supply_opening_stock_without_establishing_a_mortality_cohort() {
        let events = [event(1, EventKind::TransferIn { count: 20 })];
        let result = compute(&events, day(1), None);
        assert_eq!(result.live_headcount, Metric::Available { value: 20 });
        assert_eq!(
            result.mortality_rate,
            Metric::Unavailable {
                reason: MissingInput::IncompleteMortalityCohort
            }
        );
    }

    #[test]
    fn computes_growth_and_feed_conversion_with_contiguous_coverage_and_full_weights() {
        let events = [
            coverage(2, 3),
            intake(10),
            weigh_in(1, 10, 10.0),
            feed(1, 50.0),
            feed(2, 12.0),
            feed(3, 18.0),
            coverage(1, 2),
            weigh_in(3, 10, 25.0),
            feed(4, 80.0),
        ];
        let result = compute(&events, day(3), None);
        assert_eq!(
            result.average_daily_gain_kg,
            Metric::Available { value: 0.75 }
        );
        assert_eq!(
            result.feed_conversion_ratio,
            Metric::Available { value: 2.0 }
        );
    }

    #[test]
    fn feed_conversion_requires_complete_feed_coverage_and_exact_flock_weights() {
        let mut events = vec![
            intake(10),
            weigh_in(1, 5, 5.0),
            feed(2, 10.0),
            coverage(1, 2),
            feed(3, 25.0),
            weigh_in(4, 5, 20.0),
            coverage(3, 4),
        ];
        let gap = compute(&events, day(4), None);
        assert_eq!(gap.average_daily_gain_kg, Metric::Available { value: 1.0 });
        assert_eq!(
            gap.feed_conversion_ratio,
            Metric::Unavailable {
                reason: MissingInput::MissingFeedCoverage
            }
        );
        events.push(coverage(2, 3));
        assert_eq!(
            compute(&events, day(4), None).feed_conversion_ratio,
            Metric::Unavailable {
                reason: MissingInput::MissingWholeFlockWeights
            }
        );
    }

    #[test]
    fn changing_the_population_or_duplicating_weigh_ins_prevents_comparison() {
        let mut events = vec![
            intake(10),
            weigh_in(1, 5, 5.0),
            event(2, EventKind::TransferIn { count: 1 }),
            weigh_in(3, 5, 15.0),
        ];
        let changed = compute(&events, day(3), None);
        assert_eq!(
            changed.average_daily_gain_kg,
            Metric::Unavailable {
                reason: MissingInput::ChangedWeighInCohort
            }
        );
        events.push(weigh_in(3, 5, 17.0));
        assert_eq!(
            compute(&events, day(3), None).average_daily_gain_kg,
            Metric::Unavailable {
                reason: MissingInput::AmbiguousWeighIns
            }
        );
    }

    #[test]
    fn observes_surviving_bird_growth_while_blocking_unreconciled_feed_conversion() {
        let events = [
            intake(10),
            weigh_in(1, 10, 10.0),
            feed(2, 20.0),
            event(2, EventKind::Mortality { count: 1 }),
            coverage(1, 3),
            weigh_in(3, 9, 27.0),
        ];
        let result = compute(&events, day(3), None);
        assert_eq!(
            result.average_daily_gain_kg,
            Metric::Available { value: 1.0 }
        );
        assert_eq!(
            result.feed_conversion_ratio,
            Metric::Unavailable {
                reason: MissingInput::ChangedWeighInCohort
            }
        );
    }

    #[test]
    fn uses_only_same_cutoff_financial_evidence_and_preserves_exact_margin() {
        let events = [intake(10), processed(2, 10, Some(20.0), Some(15.0))];
        let mut proof = FinancialSnapshot {
            through: day(3),
            currency: "RWF".to_owned(),
            minor_unit_digits: 0,
            allocated_cost_minor: Some(60000),
            costed_output_kg: Some(15.0),
            net_sales_minor: Some(9_007_199_254_740_993),
            cost_of_goods_sold_minor: Some(9_007_199_254_730_992),
        };
        let stale = compute(&events, day(2), Some(&proof));
        assert_eq!(
            stale.cost_per_sellable_kg,
            Metric::Unavailable {
                reason: MissingInput::MissingRecognizedCosts
            }
        );
        proof.through = day(2);
        let exact = compute(&events, day(2), Some(&proof));
        let serialized = serde_json::to_value(exact).unwrap();
        assert_eq!(
            serialized["costPerSellableKg"]["value"]["amountMinorPerKg"],
            4000.0
        );
        assert_eq!(serialized["margin"]["value"]["amountMinor"], "10001");

        proof.costed_output_kg = Some(14.0);
        proof.cost_of_goods_sold_minor = None;
        let mismatched = compute(&events, day(2), Some(&proof));
        assert_eq!(
            mismatched.cost_per_sellable_kg,
            Metric::Unavailable {
                reason: MissingInput::MissingRecognizedCosts
            }
        );
        assert_eq!(
            mismatched.margin,
            Metric::Unavailable {
                reason: MissingInput::MissingTraceableSales
            }
        );
    }

    #[test]
    fn serializes_missing_data_separately_from_zero() {
        let value = serde_json::to_value(compute(&[intake(10)], day(1), None)).unwrap();
        assert_eq!(
            value["mortalityRate"],
            serde_json::json!({"status": "available", "value": 0.0})
        );
        assert_eq!(
            value["processingYield"],
            serde_json::json!({"status": "unavailable", "reason": "noProcessing"})
        );
    }
}

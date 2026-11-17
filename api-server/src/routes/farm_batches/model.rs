use std::collections::BTreeMap;

use chrono::NaiveDate;
use serde::{de::Error as _, Deserialize, Deserializer, Serialize};

use crate::error::ApiError;

pub(crate) mod date {
    use chrono::NaiveDate;
    use serde::{de::Error as _, Deserialize, Deserializer, Serializer};

    pub(super) fn serialize<S: Serializer>(
        date: &NaiveDate,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&date.to_string())
    }

    pub(super) fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<NaiveDate, D::Error> {
        let value = String::deserialize(deserializer)?;
        parse(&value).map_err(D::Error::custom)
    }

    pub(in super::super) fn parse(value: &str) -> Result<NaiveDate, &'static str> {
        let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map_err(|_| "business dates need YYYY-MM-DD format")?;
        if value.len() != 10 || date.to_string() != value || value.starts_with("0000") {
            return Err("business dates need YYYY-MM-DD format");
        }
        Ok(date)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct BatchInput {
    pub reference: String,
    pub species: String,
    #[serde(with = "date")]
    pub start_date: NaiveDate,
    pub location: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EventInput {
    #[serde(with = "date")]
    pub business_date: NaiveDate,
    #[serde(flatten)]
    pub kind: EventKind,
}

impl<'de> Deserialize<'de> for EventInput {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let mut fields = serde_json::Map::deserialize(deserializer)?;
        let date = fields
            .remove("businessDate")
            .ok_or_else(|| D::Error::missing_field("businessDate"))?;
        let business_date = date
            .as_str()
            .ok_or_else(|| D::Error::custom("invalid business date"))?;
        let business_date = date::parse(business_date).map_err(D::Error::custom)?;
        let kind =
            serde_json::from_value(serde_json::Value::Object(fields)).map_err(D::Error::custom)?;
        Ok(Self {
            business_date,
            kind,
        })
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    deny_unknown_fields,
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub(crate) enum EventKind {
    Intake {
        count: u32,
    },
    Mortality {
        count: u32,
    },
    TransferIn {
        count: u32,
    },
    TransferOut {
        count: u32,
    },
    InternalTransfer {
        count: u32,
    },
    LiveSale {
        count: u32,
    },
    Processing {
        count: u32,
        live_weight_kg: Option<f64>,
        sellable_weight_kg: Option<f64>,
    },
    WeighIn {
        sample_count: u32,
        total_weight_kg: f64,
    },
    FeedUsage {
        feed_product: String,
        quantity_kg: f64,
    },
    FeedCoverage {
        #[serde(with = "date")]
        from_exclusive: NaiveDate,
    },
}

impl EventKind {
    pub(super) fn headcount_delta(&self) -> i64 {
        use EventKind::*;
        match self {
            Intake { count } | TransferIn { count } => i64::from(*count),
            Mortality { count }
            | TransferOut { count }
            | LiveSale { count }
            | Processing { count, .. } => -i64::from(*count),
            InternalTransfer { .. } | WeighIn { .. } | FeedUsage { .. } | FeedCoverage { .. } => 0,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EventSource {
    pub file: String,
    pub sha256: String,
    pub sheet: Option<String>,
    pub row: u32,
    #[serde(with = "decimal_i64")]
    pub review_batch_id: i64,
    #[serde(with = "decimal_i64")]
    pub review_item_id: i64,
    pub revision: i32,
}

mod decimal_i64 {
    use serde::{de::Error as _, Deserialize, Deserializer, Serializer};

    pub(super) fn serialize<S: Serializer>(id: &i64, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&id.to_string())
    }

    pub(super) fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(D::Error::custom)
    }
}

pub(crate) fn validate_request_key(value: &str) -> Result<(), ApiError> {
    if !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'-' | b'_' | b'.'))
    {
        Ok(())
    } else {
        Err(ApiError::BadRequest("invalid farm request key".into()))
    }
}

pub(super) fn text_field(label: &str, value: &str, max_bytes: usize) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() || value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(ApiError::BadRequest(format!("invalid farm {label}")));
    }
    Ok(value.to_owned())
}

impl BatchInput {
    pub(super) fn normalized(&self) -> Result<Self, ApiError> {
        Ok(Self {
            reference: text_field("reference", &self.reference, 128)?,
            species: text_field("species", &self.species, 80)?,
            start_date: self.start_date,
            location: text_field("location", &self.location, 160)?,
        })
    }
}

impl EventInput {
    pub(super) fn validate(&self) -> Result<(), ApiError> {
        let positive = |value: f64| value.is_finite() && value > 0.0;
        let positive_count = |count| {
            if count > 0 {
                Ok(())
            } else {
                Err(ApiError::BadRequest(
                    "event headcount must be positive".into(),
                ))
            }
        };
        use EventKind::*;
        match &self.kind {
            Intake { count }
            | Mortality { count }
            | TransferIn { count }
            | TransferOut { count }
            | InternalTransfer { count }
            | LiveSale { count } => positive_count(*count),
            Processing {
                count,
                live_weight_kg,
                sellable_weight_kg,
            } => {
                positive_count(*count)?;
                if !live_weight_kg.map_or(true, positive)
                    || !sellable_weight_kg
                        .map_or(true, |weight| weight.is_finite() && weight >= 0.0)
                    || matches!((live_weight_kg, sellable_weight_kg), (Some(live), Some(sellable)) if sellable > live)
                {
                    return Err(ApiError::BadRequest("invalid processing weights".into()));
                }
                Ok(())
            }
            WeighIn {
                sample_count,
                total_weight_kg,
            } => {
                positive_count(*sample_count)?;
                if !positive(*total_weight_kg) {
                    return Err(ApiError::BadRequest(
                        "sample weight must be positive".into(),
                    ));
                }
                Ok(())
            }
            FeedUsage {
                feed_product,
                quantity_kg,
            } => {
                if text_field("feed product", feed_product, 160)? != *feed_product
                    || !positive(*quantity_kg)
                {
                    return Err(ApiError::BadRequest(
                        "invalid feed product or quantity".into(),
                    ));
                }
                Ok(())
            }
            FeedCoverage { from_exclusive } => {
                if *from_exclusive >= self.business_date {
                    return Err(ApiError::BadRequest(
                        "feed coverage needs an earlier start date".into(),
                    ));
                }
                Ok(())
            }
        }
    }
}

pub(crate) fn validate_timeline(
    start_date: NaiveDate,
    events: &[EventInput],
) -> Result<(), ApiError> {
    for event in events {
        event.validate()?;
        if event.business_date < start_date
            || matches!(&event.kind, EventKind::FeedCoverage { from_exclusive } if *from_exclusive < start_date)
        {
            return Err(ApiError::Conflict("farm event predates the batch".into()));
        }
    }
    live_headcount(events, None)?;
    Ok(())
}

#[derive(Default)]
struct DailyHeadcount {
    incoming: u64,
    outgoing: u64,
    required_present: u64,
}

pub(super) fn live_headcount(
    events: &[EventInput],
    as_of: Option<NaiveDate>,
) -> Result<u64, ApiError> {
    let overflow = || ApiError::Conflict("farm headcount exceeds the supported range".into());
    let mut changes = BTreeMap::<NaiveDate, DailyHeadcount>::new();
    for event in events {
        if as_of.is_some_and(|cutoff| event.business_date > cutoff) {
            continue;
        }
        let day = changes.entry(event.business_date).or_default();
        let delta = event.kind.headcount_delta();
        if delta > 0 {
            day.incoming = day
                .incoming
                .checked_add(delta.unsigned_abs())
                .ok_or_else(overflow)?;
        } else if delta < 0 {
            day.outgoing = day
                .outgoing
                .checked_add(delta.unsigned_abs())
                .ok_or_else(overflow)?;
        }
        if let EventKind::InternalTransfer { count } = &event.kind {
            day.required_present = day.required_present.max(u64::from(*count));
        }
    }
    let mut headcount = 0u64;
    for (date, day) in changes {
        let available = headcount.checked_add(day.incoming).ok_or_else(overflow)?;
        if day.outgoing.max(day.required_present) > available {
            return Err(ApiError::Conflict(format!(
                "farm events exceed available headcount on {date}"
            )));
        }
        headcount = available - day.outgoing;
    }
    Ok(headcount)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn event(value: serde_json::Value) -> EventInput {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn daily_headcount_is_order_independent_within_a_business_date_and_respects_cutoff() {
        let events = [
            event(json!({"kind":"mortality","businessDate":"2026-01-02","count":4})),
            event(json!({"kind":"intake","businessDate":"2026-01-02","count":100})),
            event(json!({"kind":"processing","businessDate":"2026-02-01","count":80})),
            event(json!({"kind":"internalTransfer","businessDate":"2026-02-01","count":16})),
        ];
        let start = date::parse("2026-01-02").unwrap();
        validate_timeline(start, &events).unwrap();
        assert_eq!(live_headcount(&events, Some(start)).unwrap(), 96);
        assert_eq!(live_headcount(&events, None).unwrap(), 16);
        assert!(validate_timeline(start, &events[..1]).is_err());
    }

    #[test]
    fn sourced_event_keys_round_trip_as_lossless_strings() {
        let source = EventSource {
            file: "Farm.xlsx".into(),
            sha256: "0".repeat(64),
            sheet: Some("Weights & Feed".into()),
            row: 12,
            review_batch_id: i64::MAX,
            review_item_id: i64::MAX - 1,
            revision: 2,
        };
        let json = serde_json::to_value(&source).unwrap();
        assert_eq!(json["reviewBatchId"], i64::MAX.to_string());
        assert_eq!(serde_json::from_value::<EventSource>(json).unwrap(), source);
    }

    #[test]
    fn rejects_invalid_dates_and_unphysical_weights() {
        assert!(serde_json::from_value::<EventInput>(json!({
            "kind":"intake","businessDate":"2026-02-29","count":100
        }))
        .is_err());
        assert!(serde_json::from_value::<EventInput>(json!({
            "kind":"mortality","businessDate":"2026-02-28","count":4,"warehouseMoveId":"7"
        }))
        .is_err());
        let bad_processing = event(json!({
            "kind":"processing","businessDate":"2026-02-28","count":1,
            "liveWeightKg":2.0,"sellableWeightKg":3.0
        }));
        assert!(bad_processing.validate().is_err());
        let coverage = event(json!({
            "kind":"feedCoverage","businessDate":"2026-02-28","fromExclusive":"2026-01-01"
        }));
        coverage.validate().unwrap();
        assert_eq!(
            serde_json::to_value(coverage).unwrap()["fromExclusive"],
            "2026-01-01"
        );
    }
}

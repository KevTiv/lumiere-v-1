use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio_postgres::{Row, Transaction};

use super::{decimal, Module};
use crate::{error::ApiError, routes::import_reviews::model::SourceReference};

pub(super) struct BackfillRow<'a> {
    pub organization: &'a str,
    pub company: &'a str,
    pub module: Module,
    pub source: &'a SourceReference,
    pub period_start: &'a str,
    pub period_end: &'a str,
    pub facts: &'a Value,
}

pub(super) enum Existing {
    None,
    Matched(SavedRecord),
    Held(&'static str),
    Conflict(&'static str),
}

pub(super) struct SavedRecord {
    pub id: i64,
    pub item: i64,
    pub revision: i32,
}

const SAVED_FIELDS: &str =
    "id, item_id, source_revision, source_worksheet, period_start::text, period_end::text, facts";

impl BackfillRow<'_> {
    pub fn business_key(&self) -> Result<Option<String>, ApiError> {
        let Some((issuer, reference)) = self.facts["saleLineIssuer"]
            .as_str()
            .zip(self.facts["saleLineReference"].as_str())
        else {
            return Ok(None);
        };
        let shop = self.facts["shop"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase();
        let key = serde_json::to_vec(&(shop, issuer, reference)).map_err(ApiError::internal)?;
        Ok(Some(hex::encode(Sha256::digest(key))))
    }

    fn worksheet(&self) -> &str {
        self.source.sheet.as_deref().unwrap_or_default()
    }

    fn match_saved(&self, saved: &Row, conflict: &'static str) -> Existing {
        let facts: Value = saved.get("facts");
        if saved.get::<_, &str>("period_start") != self.period_start
            || saved.get::<_, &str>("period_end") != self.period_end
            || !same_facts(self.facts, &facts)
        {
            return Existing::Conflict(conflict);
        }
        Existing::Matched(SavedRecord {
            id: saved.get("id"),
            item: saved.get("item_id"),
            revision: saved.get("source_revision"),
        })
    }

    pub async fn existing(
        &self,
        tx: &Transaction<'_>,
        key: &Option<String>,
    ) -> Result<Existing, ApiError> {
        let module = self.module.storage_name();
        let number = i64::from(self.source.row);
        let worksheet = self.worksheet();
        let exact = tx
            .query_opt(
                &format!(
                    "SELECT {SAVED_FIELDS} FROM lumiere_platform.module_backfill_record
             WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric
               AND module=$3 AND source_sha256=$4 AND source_row=$5
               AND source_worksheet IN ($6, '')
             ORDER BY (source_worksheet=$6) DESC LIMIT 1"
                ),
                &[
                    &self.organization,
                    &self.company,
                    &module,
                    &self.source.sha256,
                    &number,
                    &worksheet,
                ],
            )
            .await
            .map_err(ApiError::internal)?;
        if let Some(saved) = exact {
            if !worksheet.is_empty() && saved.get::<_, &str>("source_worksheet").is_empty() {
                return Ok(Existing::Held("An earlier import of these bytes did not preserve its worksheet. Review the saved record before importing this row."));
            }
            return Ok(self.match_saved(
                &saved,
                "A saved record for this source row has different values.",
            ));
        }

        if !matches!(self.module, Module::ShopSales) {
            return Ok(Existing::None);
        }
        if let Some(key) = key {
            let saved = tx
                .query_opt(
                    &format!(
                        "SELECT {SAVED_FIELDS} FROM lumiere_platform.module_backfill_record
                 WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric
                   AND module='sales' AND business_key=$3"
                    ),
                    &[&self.organization, &self.company, key],
                )
                .await
                .map_err(ApiError::internal)?;
            if let Some(saved) = saved {
                return Ok(self.match_saved(&saved, "This sale line reference is already saved with different values. Review both sources before proceeding."));
            }
        }

        // Equal product, day and shop are overlap evidence. Only a shared
        // stable identifier can prove the rows describe the same event.
        let overlaps: bool = tx
            .query_one(
                "SELECT EXISTS (SELECT 1 FROM lumiere_platform.module_backfill_record
             WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric
               AND module='sales' AND facts->>'kind'='shop_sale' AND period_start=$3::text::date
               AND lower(facts->>'shop')=lower($4) AND lower(facts->>'product')=lower($5)
               AND source_sha256<>$6 AND ($7::text IS NULL OR business_key IS NULL))",
                &[
                    &self.organization,
                    &self.company,
                    &self.period_start,
                    &self.facts["shop"].as_str(),
                    &self.facts["product"].as_str(),
                    &self.source.sha256,
                    key,
                ],
            )
            .await
            .map_err(ApiError::internal)?
            .get(0);
        if overlaps {
            return Ok(Existing::Held("This shop, sale date and product overlap another export. Verify the original line references before importing again."));
        }
        Ok(Existing::None)
    }

    pub async fn save(
        &self,
        tx: &Transaction<'_>,
        batch: i64,
        item: i64,
        revision: i32,
        actor: &str,
        key: &Option<String>,
    ) -> Result<Option<i64>, ApiError> {
        let result = tx.query_opt(
            "INSERT INTO lumiere_platform.module_backfill_record
             (organization_id, company_id, module, batch_id, item_id, source_revision, source_sha256,
              source_worksheet, source_row, source_file, period_start, period_end, facts, created_by, business_key)
             VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7,$8,$9,$10,$11::text::date,$12::text::date,$13,$14,$15)
             ON CONFLICT DO NOTHING RETURNING id",
            &[&self.organization, &self.company, &self.module.storage_name(), &batch, &item, &revision,
              &self.source.sha256, &self.worksheet(), &i64::from(self.source.row), &self.source.file,
              &self.period_start, &self.period_end, &self.facts, &actor, key],
        ).await.map_err(ApiError::internal)?;
        Ok(result.map(|row| row.get("id")))
    }
}

fn same_facts(left: &Value, right: &Value) -> bool {
    if left == right {
        return true;
    }
    let Some((left, right)) = left.as_object().zip(right.as_object()) else {
        return false;
    };
    left.get("kind").and_then(Value::as_str) == Some("shop_sale")
        && left.len() == right.len()
        && left.iter().all(|(key, left)| {
            right.get(key).is_some_and(|right| {
                if matches!(key.as_str(), "quantity" | "unitPrice" | "amount") {
                    left.as_str()
                        .and_then(decimal)
                        .zip(right.as_str().and_then(decimal))
                        .is_some_and(|(left, right)| left == right)
                } else {
                    left == right
                }
            })
        })
}

/// Overlap decisions must observe other writes for this company even if
/// they use a different original hash and therefore a different unique key.
pub(super) async fn lock_shop_sales(
    tx: &Transaction<'_>,
    organization: &str,
    company: &str,
) -> Result<(), ApiError> {
    let scope = format!("lumiere.shop-sales.{organization}.{company}");
    tx.query_one(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&scope],
    )
    .await
    .map_err(ApiError::internal)?;
    Ok(())
}

#[cfg(test)]
pub(in crate::routes::import_reviews) async fn exercise_persistence(
    tx: &Transaction<'_>,
    batch: i64,
    item: i64,
) -> anyhow::Result<()> {
    use anyhow::{ensure, Context};
    use serde_json::json;

    let source = SourceReference {
        file: "audits.xlsx".into(),
        row: 10,
        sha256: "b".repeat(64),
        sheet: Some("April".into()),
        multi_worksheet: true,
        row_basis: Default::default(),
    };
    let facts = json!({"kind":"shop_sale","shop":"Kicukiro","product":"Whole chicken",
        "quantity":"2","unitPrice":"1000","amount":"2000","currency":"RWF",
        "saleLineIssuer":"POS-2","saleLineReference":"0008"});
    let first = BackfillRow {
        organization: "8001",
        company: "9001",
        module: Module::ShopSales,
        source: &source,
        period_start: "2024-04-01",
        period_end: "2024-04-01",
        facts: &facts,
    };
    let first_key = first.business_key()?;
    ensure!(matches!(
        first.existing(tx, &first_key).await?,
        Existing::None
    ));
    let first_id = first
        .save(tx, batch, item, 2, "actor-one", &first_key)
        .await?
        .context("first exact row was not saved")?;
    ensure!(
        matches!(first.existing(tx, &first_key).await?, Existing::Matched(record) if record.id == first_id)
    );

    let other_sheet = SourceReference {
        sheet: Some("Audited".into()),
        ..source.clone()
    };
    let mut other_facts = facts.clone();
    other_facts["saleLineReference"] = json!("0009");
    let other_row = BackfillRow {
        source: &other_sheet,
        facts: &other_facts,
        ..first
    };
    let other_key = other_row.business_key()?;
    ensure!(matches!(
        other_row.existing(tx, &other_key).await?,
        Existing::None
    ));
    let other_id = other_row
        .save(tx, batch, item, 2, "actor-one", &other_key)
        .await?
        .context("same row in another worksheet was not saved")?;
    ensure!(first_id != other_id);

    let regenerated = SourceReference {
        sha256: "c".repeat(64),
        row: 21,
        ..source.clone()
    };
    let mut equivalent_facts = facts.clone();
    equivalent_facts["amount"] = json!("2000.00");
    let replay = BackfillRow {
        source: &regenerated,
        facts: &equivalent_facts,
        ..first
    };
    ensure!(replay.business_key()? == first_key);
    ensure!(
        matches!(replay.existing(tx, &first_key).await?, Existing::Matched(record) if record.id == first_id)
    );

    let mut changed_facts = facts.clone();
    changed_facts["currency"] = json!("USD");
    let changed = BackfillRow {
        facts: &changed_facts,
        ..replay
    };
    ensure!(matches!(
        changed.existing(tx, &first_key).await?,
        Existing::Conflict(_)
    ));

    let no_identity = json!({"kind":"shop_sale","shop":"KICUKIRO","product":"Whole chicken",
        "quantity":"2","unitPrice":"1000","amount":"2000","currency":"RWF"});
    let ambiguous = BackfillRow {
        facts: &no_identity,
        ..replay
    };
    ensure!(ambiguous.business_key()?.is_none());
    ensure!(matches!(
        ambiguous.existing(tx, &None).await?,
        Existing::Held(_)
    ));

    let foreign = BackfillRow {
        company: "9002",
        ..replay
    };
    ensure!(matches!(
        foreign.existing(tx, &first_key).await?,
        Existing::None
    ));
    Ok(())
}

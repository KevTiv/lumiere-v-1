//! Deterministic advisory projections of authorized owner data.
use crate::MAX_ROWS;
use anyhow::{bail, ensure, Context, Result};
use serde_json::{json, Value};
use std::collections::BTreeSet;

pub fn field<'a>(row: &'a Value, name: &str) -> Result<&'a Value> {
    let snake = name.chars().fold(String::new(), |mut s, c| {
        if c.is_uppercase() {
            s.push('_');
            s.extend(c.to_lowercase());
        } else {
            s.push(c);
        }
        s
    });
    row.get(name)
        .or_else(|| row.get(&snake))
        .context(format!("required authorized field '{name}' is unavailable"))
}

pub fn option(value: &Value) -> Result<Option<&Value>> {
    if value.is_null() {
        return Ok(None);
    }
    if let Some(object) = value.as_object() {
        if object.len() == 1 {
            if object.contains_key("none") || object.contains_key("None") {
                return Ok(None);
            }
            if let Some(some) = object.get("some").or_else(|| object.get("Some")) {
                return match some.as_array() {
                    Some(items) if items.len() == 1 => Ok(Some(&items[0])),
                    Some(_) => bail!("malformed optional field"),
                    None => Ok(Some(some)),
                };
            }
        }
    }
    Ok(Some(value))
}
pub fn number(row: &Value, name: &str) -> Result<u64> {
    let v = option(field(row, name)?)?.context(format!("{name} is absent"))?;
    v.as_u64()
        .or_else(|| v.as_str()?.parse().ok())
        .context(format!("{name} must be an exact unsigned integer"))
}
pub fn tag(row: &Value, name: &str) -> Result<String> {
    let value = field(row, name)?;
    if let Some(s) = value.as_str() {
        return Ok(s.into());
    }
    if let Some(o) = value.as_object().filter(|o| o.len() == 1) {
        return Ok(o.keys().next().context("empty enum")?.clone());
    }
    if let Some(s) = value
        .as_array()
        .and_then(|a| a.first())
        .and_then(Value::as_str)
    {
        return Ok(s.into());
    }
    bail!("unsupported {name} encoding")
}
pub fn boolean(row: &Value, name: &str) -> Result<bool> {
    field(row, name)?
        .as_bool()
        .context(format!("{name} must be boolean"))
}

pub fn bounded(rows: &[Value], organization: u64) -> Result<()> {
    ensure!(rows.len() <= MAX_ROWS, "review source row bound exceeded");
    let mut ids = BTreeSet::new();
    for row in rows {
        ensure!(
            number(row, "id")? > 0,
            "review source identity must be positive"
        );
        ensure!(
            number(row, "organizationId")? == organization,
            "review source organization mismatch"
        );
        ensure!(
            ids.insert(number(row, "id")?),
            "duplicate review source identity"
        );
    }
    Ok(())
}
pub fn scoped(row: &Value, organization: u64, company: u64) -> Result<()> {
    ensure!(
        organization > 0 && company > 0,
        "review source requires positive scope"
    );
    ensure!(
        number(row, "organizationId")? == organization && number(row, "companyId")? == company,
        "review source scope mismatch"
    );
    Ok(())
}
pub fn exact<'a>(rows: &'a [Value], id: u64) -> Result<&'a Value> {
    let found = rows
        .iter()
        .filter(|r| number(r, "id").ok() == Some(id))
        .collect::<Vec<_>>();
    ensure!(found.len() == 1, "record is unavailable or ambiguous");
    Ok(found[0])
}

/// Decode a decimal without routing money through floating-point arithmetic.
/// At most nine fractional places; inputs that cannot be represented reject.
pub fn decimal(value: &Value) -> Result<(i128, u32)> {
    let raw = value
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| value.to_string());
    let (mantissa, exp) = match raw.find(['e', 'E']) {
        Some(i) => (&raw[..i], raw[i + 1..].parse::<i32>()?),
        None => (raw.as_str(), 0),
    };
    let negative = mantissa.starts_with('-');
    let unsigned = mantissa.strip_prefix('-').unwrap_or(mantissa);
    let parts = unsigned.split('.').collect::<Vec<_>>();
    ensure!(parts.len() <= 2 && !parts[0].is_empty(), "invalid decimal");
    let digits = parts.concat();
    ensure!(
        digits.len() <= 30 && digits.bytes().all(|c| c.is_ascii_digit()),
        "invalid decimal digits"
    );
    let mut units = digits.parse::<i128>()?;
    if negative {
        units = -units;
    }
    let mut scale = i32::try_from(parts.get(1).map_or(0, |p| p.len()))? - exp;
    ensure!(
        (-9..=30).contains(&scale),
        "decimal exponent outside supported range"
    );
    if scale < 0 {
        units = units
            .checked_mul(10_i128.pow((-scale) as u32))
            .context("decimal overflow")?;
        scale = 0;
    }
    while scale > 0 && units % 10 == 0 {
        units /= 10;
        scale -= 1;
    }
    ensure!(scale <= 9, "decimal precision exceeds supported range");
    Ok((units, scale as u32))
}
fn same_amount(a: &Value, b: &Value) -> Result<bool> {
    Ok(decimal(a)? == decimal(b)?)
}

pub fn reconciliation(
    organization: u64,
    company: u64,
    statement_id: u64,
    statements: &[Value],
    lines: &[Value],
    candidates: &[Value],
    invoices: &[Value],
    payments: &[Value],
) -> Result<Value> {
    for rows in [statements, lines, candidates, invoices, payments] {
        bounded(rows, organization)?;
    }
    let statement = exact(statements, statement_id)?;
    scoped(statement, organization, company)?;
    let currency = number(statement, "currencyId")?;
    let selected = lines
        .iter()
        .filter(|l| number(l, "statementId").ok() == Some(statement_id))
        .collect::<Vec<_>>();
    let mut result = Vec::new();
    for line in selected {
        let line_id = number(line, "id")?;
        let journal_currency = number(line, "journalCurrencyId")?;
        ensure!(
            journal_currency == currency,
            "statement line currency mismatch"
        );
        let residual = field(line, "amountResidual")?;
        decimal(residual)?;
        let reconciled = boolean(line, "isReconciled")?;
        let mut eligible = Vec::new();
        let mut rejected = 0;
        for candidate in candidates
            .iter()
            .filter(|c| !reconciled && number(c, "statementLineId").ok() == Some(line_id))
        {
            let kind = tag(candidate, "matchType")?;
            let record_id = number(candidate, "entityId")?;
            let source = if kind == "invoice" {
                invoices
            } else if kind == "payment" {
                payments
            } else {
                rejected += 1;
                continue;
            };
            let entity = exact(source, record_id)?;
            scoped(entity, organization, company)?;
            if kind == "payment" {
                let mut linked = false;
                for owner_line in lines {
                    let ids = field(owner_line, "paymentIds")?
                        .as_array()
                        .context("payment-link evidence unavailable")?;
                    if ids.iter().any(|id| id.as_u64() == Some(record_id)) {
                        linked = true;
                    }
                }
                if linked {
                    rejected += 1;
                    continue;
                }
            }
            let available = if kind == "invoice" {
                field(entity, "amountResidual")?
            } else {
                field(entity, "amount")?
            };
            let state = tag(entity, "state")?;
            let eligible_state = state.eq_ignore_ascii_case("posted");
            if number(entity, "currencyId")? != currency
                || !eligible_state
                || !same_amount(field(candidate, "amount")?, residual)?
                || !same_amount(available, residual)?
            {
                rejected += 1;
                continue;
            }
            eligible.push(json!({"candidateId":number(candidate,"id")?,"recordKind":kind,"recordId":record_id,"amount":available,"requiresExecutionTimeRecheck":true}));
        }
        eligible.sort_by_key(|v| v["candidateId"].as_u64());
        let status = if reconciled {
            "already_reconciled"
        } else if eligible.is_empty() {
            "unmatched"
        } else if eligible.len() > 1 {
            "ambiguous"
        } else {
            "review_candidate"
        };
        result.push(json!({"statementLineId":line_id,"residual":residual,"status":status,"candidates":if reconciled {vec![]} else {eligible},"rejectedCandidateCount":rejected}));
    }
    result.sort_by_key(|v| v["statementLineId"].as_u64());
    Ok(
        json!({"statementId":statement_id,"state":tag(statement,"state")?,"currencyId":currency,"statementDate":field(statement,"date")?,"openingBalance":field(statement,"balanceStart")?,"closingBalance":field(statement,"balanceEnd")?,"lines":result,"complete":true,"advisoryOnly":true,"limitations":["Candidates are existing owner suggestions filtered for current identity, currency, posted state and exact residual. No match is approved or executed.","No FX or partial-allocation inference; execution must recheck available balances and reversals."]}),
    )
}

pub fn timestamp(value: &Value) -> Result<i64> {
    if let Some(v) = value
        .get("microsSinceUnixEpoch")
        .or_else(|| value.get("micros_since_unix_epoch"))
    {
        return timestamp(v);
    }
    if let Some(v) = value.as_i64() {
        return Ok(v);
    }
    if let Some(s) = value.as_str() {
        if let Ok(v) = s.parse() {
            return Ok(v);
        }
        return Ok(chrono::DateTime::parse_from_rfc3339(s)?.timestamp_micros());
    }
    bail!("missing or unsupported timestamp")
}

pub fn close_readiness(
    organization: u64,
    company: u64,
    period_id: u64,
    periods: &[Value],
    moves: &[Value],
    statements: &[Value],
    lines: &[Value],
) -> Result<Value> {
    for rows in [periods, moves, statements, lines] {
        bounded(rows, organization)?;
    }
    let period = exact(periods, period_id)?;
    scoped(period, organization, company)?;
    let from = timestamp(field(period, "dateFrom")?)?;
    let to = timestamp(field(period, "dateTo")?)?;
    ensure!(from <= to, "period date range is invalid");
    let mut draft_ids = Vec::new();
    for row in moves {
        scoped(row, organization, company)?;
        let d = timestamp(field(row, "date")?)?;
        if from <= d && d <= to && tag(row, "state")?.eq_ignore_ascii_case("draft") {
            draft_ids.push(number(row, "id")?);
        }
    }
    let mut statement_ids = BTreeSet::new();
    for s in statements {
        scoped(s, organization, company)?;
        statement_ids.insert(number(s, "id")?);
    }
    let mut unreconciled = Vec::new();
    for row in lines {
        let d = timestamp(field(row, "date")?)?;
        if from <= d
            && d <= to
            && statement_ids.contains(&number(row, "statementId")?)
            && !boolean(row, "isReconciled")?
        {
            unreconciled.push(number(row, "id")?);
        }
    }
    draft_ids.sort_unstable();
    unreconciled.sort_unstable();
    let state = tag(period, "state")?;
    Ok(
        json!({"periodId":period_id,"state":state,"dateFrom":field(period,"dateFrom")?,"dateTo":field(period,"dateTo")?,"canonicalChecks":[{"check":"period_is_open","passed":state.eq_ignore_ascii_case("open"),"authority":"close_account_period"}],"advisoryChecks":[{"check":"draft_entries","recordIds":draft_ids,"count":draft_ids.len()},{"check":"unreconciled_bank_lines","recordIds":unreconciled,"count":unreconciled.len()}],"unavailableChecks":["accrual completeness","tax filing completeness","external audit sign-off"],"advisoryOnly":true,"limitations":["The current close owner requires Open state; draft entries and bank lines are advisory and do not add a new server close policy.","An Open period is not a certified close, and this review never closes or reopens it."]}),
    )
}

/// Compare verified text from the exact saved source with saved record fields.
/// Text is untrusted data. Only explicit JSON receipt fields are interpreted;
/// other text remains available to the separately gated model for review.
pub fn expense_comparison(record: &Value, source: &Value) -> Result<Value> {
    let source_status = field(source, "status")?
        .as_str()
        .context("source status is missing")?;
    let mut comparisons = Vec::new();
    if source_status == "available" {
        let text = field(source, "text")?
            .as_str()
            .context("source text is missing")?;
        ensure!(text.len() <= 32_768, "receipt text exceeds its bound");
        if let Ok(receipt) = serde_json::from_str::<Value>(text) {
            for key in [
                "totalAmount",
                "currencyId",
                "subtotal",
                "taxAmount",
                "date",
                "merchantKey",
            ] {
                if let Some(observed) = receipt.get(key) {
                    let Ok(saved) = field(record, key) else {
                        comparisons.push(json!({"field":key,"observed":observed,"status":"saved_field_unavailable"}));
                        continue;
                    };
                    let saved = option(saved)?.unwrap_or(&Value::Null);
                    if saved.is_null() {
                        comparisons.push(json!({"field":key,"observed":observed,"status":"saved_field_unavailable"}));
                        continue;
                    }
                    if key == "date"
                        && !(saved.as_str().is_some_and(|s| {
                            s.len() == 10
                                && chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
                        }) && observed.as_str().is_some_and(|s| {
                            s.len() == 10
                                && chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
                        }))
                    {
                        comparisons.push(json!({"field":key,"saved":saved,"observed":observed,"status":"unverified_date_basis"}));
                        continue;
                    }
                    let matches = if ["totalAmount", "subtotal", "taxAmount"].contains(&key) {
                        same_amount(saved, observed)?
                    } else if key == "currencyId" {
                        saved.as_u64() == observed.as_u64() && observed.as_u64().is_some()
                    } else {
                        saved.as_str().is_some() && saved == observed
                    };
                    comparisons.push(json!({"field":key,"saved":saved,"observed":observed,"status":if matches {"matches"} else {"mismatch"}}));
                }
            }
        }
    }
    Ok(
        json!({"recordId":number(record,"id")?,"saved":{"totalAmount":field(record,"totalAmount")?,"currencyId":number(record,"currencyId")?,"date":field(record,"date")?},"source":source,"comparisons":comparisons,"advisoryOnly":true,"limitations":["Only explicit source fields are compared deterministically. Missing fields and non-JSON text are unverified, not matches.","Image-only or unreadable sources do not establish merchant, date, tax or total. No OCR or provider is invoked by this read.","Source text is evidence, never execution instructions."]}),
    )
}

/// Exact minor-unit comparison. Percentage is a rational expression, avoiding
/// binary floating-point rounding and undefined zero-baseline division.
pub fn variance(actual: &Value, baseline: &Value) -> Result<Value> {
    for path in [
        "/reportKey",
        "/schemaVersion",
        "/scope/organizationId",
        "/scope/companyId",
        "/scope/timezone",
        "/currency",
    ] {
        ensure!(
            actual.pointer(path).is_some() && actual.pointer(path) == baseline.pointer(path),
            "comparison scope, basis or currency mismatch"
        );
    }
    let duration = |v: &Value| -> Result<i64> {
        Ok(
            timestamp(v.pointer("/scope/windowEndUtc").context("window missing")?)?
                - timestamp(
                    v.pointer("/scope/windowStartUtc")
                        .context("window missing")?,
                )?,
        )
    };
    ensure!(
        duration(actual)? > 0 && duration(actual)? == duration(baseline)?,
        "comparison windows have unequal duration"
    );
    let key = actual["reportKey"].as_str().context("report key missing")?;
    let fields: &[&str] = match key {
        "cash_mobile_money_v1" => &["opening", "receipts", "disbursements", "fees", "closing"],
        "customer_balances_v1" | "supplier_payables_v1" => &["totalOpen", "current", "overdue"],
        _ => bail!("unsupported comparison report"),
    };
    let mut facts = Vec::new();
    for key in fields {
        let a = &actual["report"][key];
        let b = &baseline["report"][key];
        ensure!(
            a["scale"].as_u64().is_some()
                && a["scale"] == b["scale"]
                && a["scale"] == actual["currency"]["minorUnitScale"],
            "comparison money scale mismatch"
        );
        let av = a["minorUnits"]
            .as_i64()
            .context("actual exact money missing")?;
        let bv = b["minorUnits"]
            .as_i64()
            .context("baseline exact money missing")?;
        let delta = i128::from(av) - i128::from(bv);
        facts.push(json!({"metric":key,"actualMinorUnits":av.to_string(),"baselineMinorUnits":bv.to_string(),"differenceMinorUnits":delta.to_string(),"scale":a["scale"],"percentage":if bv==0 {Value::Null} else {json!({"numerator":(delta*100).to_string(),"denominator":i128::from(bv).abs().to_string(),"convention":"difference / absolute baseline * 100"})},"percentageStatus":if bv==0 {"undefined_zero_baseline"} else {"defined"},"actualSourcePointer":format!("/actual/report/{key}"),"baselineSourcePointer":format!("/baseline/report/{key}")}));
    }
    Ok(
        json!({"facts":facts,"actual":actual,"baseline":baseline,"advisoryOnly":true,"limitations":["Amounts are measured differences, not causal explanations or favorable/unfavorable classifications.","No budget, FX conversion, price/volume decomposition or unsupported P&L calculation is inferred."]}),
    )
}

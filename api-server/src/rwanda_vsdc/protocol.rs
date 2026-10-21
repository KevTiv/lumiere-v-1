use super::values::{date, datetime, digits, invalid, optional_text, text};
use super::wire::Wire;
use super::{Counter, Decimal, ValidationError};
use serde::Deserialize;
use std::fmt;

pub(crate) type Amount = Decimal<18>;
pub(crate) type Quantity = Decimal<13>;
pub(crate) type TaxRate = Decimal<7>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DeviceScope {
    pub(crate) tin: String,
    pub(crate) branch_id: String,
}

impl DeviceScope {
    pub(super) fn validate(&self) -> Result<(), ValidationError> {
        digits(&self.tin, 9, "tin")?;
        digits(&self.branch_id, 2, "bhfId")
    }
}

#[derive(Clone, Debug)]
pub(crate) struct InitializationRequest {
    pub(crate) scope: DeviceScope,
    pub(crate) device_serial_number: String,
}

impl InitializationRequest {
    pub(super) fn encode(&self) -> Result<Vec<u8>, ValidationError> {
        self.scope.validate()?;
        text(&self.device_serial_number, 100, "dvcSrlNo")?;
        Wire::Object(vec![
            ("tin", Wire::string(&self.scope.tin)),
            ("bhfId", Wire::string(&self.scope.branch_id)),
            ("dvcSrlNo", Wire::string(&self.device_serial_number)),
        ])
        .encode()
        .map_err(|_| invalid("request encoding"))
    }
}

/// Initialization can return cryptographic key material. Debug must never reveal it.
#[derive(Deserialize)]
pub(crate) struct SecretValue(String);

impl fmt::Debug for SecretValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[REDACTED]")
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializationData {
    pub(crate) info: InitializationInfo,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializationInfo {
    pub(crate) tin: String,
    #[serde(rename = "bhfId")]
    pub(crate) branch_id: String,
    pub(crate) taxpr_nm: Option<String>,
    pub(crate) bsns_actv: Option<String>,
    pub(crate) bhf_nm: Option<String>,
    pub(crate) bhf_open_dt: Option<String>,
    pub(crate) prvnc_nm: Option<String>,
    pub(crate) dstrt_nm: Option<String>,
    pub(crate) sctr_nm: Option<String>,
    pub(crate) loc_desc: Option<String>,
    pub(crate) hq_yn: Option<String>,
    pub(crate) mgr_nm: Option<String>,
    pub(crate) mgr_tel_no: Option<String>,
    pub(crate) mgr_email: Option<String>,
    pub(crate) dvc_id: String,
    // Table misspells sdicId; the example and sales response use sdcId. No silent alias.
    pub(crate) sdc_id: Option<String>,
    pub(crate) mrc_no: Option<String>,
    pub(crate) intrl_key: Option<SecretValue>,
    pub(crate) sign_key: Option<SecretValue>,
    pub(crate) cmc_key: Option<SecretValue>,
    pub(crate) last_sale_invc_no: Option<Counter>,
    pub(crate) last_pchs_invc_no: Option<Counter>,
    pub(crate) last_sale_rcpt_no: Option<Counter>,
    pub(crate) last_invc_no: Option<Counter>,
    pub(crate) last_train_invc_no: Option<Counter>,
    pub(crate) last_profrm_invc_no: Option<Counter>,
    pub(crate) last_copy_invc_no: Option<Counter>,
}

impl InitializationInfo {
    pub(super) fn validate(&self, expected: &DeviceScope) -> Result<(), ValidationError> {
        if self.tin != expected.tin || self.branch_id != expected.branch_id {
            return Err(invalid("initialization scope"));
        }
        text(&self.dvc_id, 20, "dvcId")?;
        for (value, max, field) in [
            (self.taxpr_nm.as_deref(), 60, "taxprNm"),
            (self.bsns_actv.as_deref(), 100, "bsnsActv"),
            (self.bhf_nm.as_deref(), 60, "bhfNm"),
            (self.prvnc_nm.as_deref(), 100, "prvncNm"),
            (self.dstrt_nm.as_deref(), 100, "dstrtNm"),
            (self.sctr_nm.as_deref(), 100, "sctrNm"),
            (self.loc_desc.as_deref(), 100, "locDesc"),
            (self.mgr_nm.as_deref(), 60, "mgrNm"),
            (self.mgr_tel_no.as_deref(), 20, "mgrTelNo"),
            (self.mgr_email.as_deref(), 50, "mgrEmail"),
            (self.sdc_id.as_deref(), 12, "sdcId"),
            (self.mrc_no.as_deref(), 11, "mrcNo"),
        ] {
            optional_text(value, max, field)?;
        }
        if let Some(day) = &self.bhf_open_dt {
            date(day, "bhfOpenDt")?;
        }
        if let Some(flag) = &self.hq_yn {
            if flag != "Y" && flag != "N" {
                return Err(invalid("hqYn"));
            }
        }
        for key in [&self.intrl_key, &self.sign_key, &self.cmc_key]
            .into_iter()
            .flatten()
        {
            text(&key.0, 255, "initialization key")?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum ItemTaxField {
    TableTotTaxAmt,
    ExampleTaxAmt,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum ReceiptTinField {
    TableCustTIn,
    ExampleCustTin,
}

/// This foundation performs no rounding. A future alternative requires a new review.
#[derive(Clone, Copy, Debug)]
pub(crate) enum RoundingPolicy {
    RejectFractionalMinorUnits,
}

/// Required reviewed amount convention; the specification's inconsistent example
/// cannot choose this for an installed device. Both modes reject inexact tax cents.
#[derive(Clone, Copy, Debug)]
pub(crate) enum AmountConvention {
    /// Supply/taxable/total include tax; exact tax = supply × rate / (100 + rate).
    InclusiveExact,
    /// Supply/taxable exclude tax; total = supply + exact supply × rate / 100.
    ExclusiveExact,
}

/// Required operator review record for the *installed* device version; no default exists.
/// This is configuration, not evidence that approval/certification has occurred.
#[derive(Clone, Debug)]
pub(crate) struct ReviewedSalesDialect {
    pub(crate) installed_version: String,
    pub(crate) review_reference: String,
    pub(crate) item_tax_field: ItemTaxField,
    pub(crate) receipt_tin_field: ReceiptTinField,
    pub(crate) rounding_policy: RoundingPolicy,
    pub(crate) amount_convention: AmountConvention,
}

impl ReviewedSalesDialect {
    pub(super) fn validate(&self) -> Result<(), ValidationError> {
        text(&self.installed_version, 100, "reviewed installed version")?;
        text(&self.review_reference, 200, "dialect review reference")
    }
}

/// Explicit device identity used to reject another device's receipt.
#[derive(Clone, Debug)]
pub(crate) struct SalesDeviceIdentity {
    pub(crate) sdc_id: String,
    pub(crate) mrc_no: String,
}

impl SalesDeviceIdentity {
    pub(super) fn validate(&self) -> Result<(), ValidationError> {
        text(&self.sdc_id, 12, "sdcId")?;
        text(&self.mrc_no, 11, "mrcNo")
    }
}

#[derive(Clone, Debug)]
pub(crate) enum Customer {
    Individual {
        tin: Option<String>,
        name: Option<String>,
        purchase_code: Option<String>,
    },
    Business {
        tin: String,
        name: String,
        purchase_code: String,
    },
}

impl Customer {
    fn fields(&self) -> (Option<&str>, Option<&str>, Option<&str>) {
        match self {
            Self::Individual {
                tin,
                name,
                purchase_code,
            } => (tin.as_deref(), name.as_deref(), purchase_code.as_deref()),
            Self::Business {
                tin,
                name,
                purchase_code,
            } => (Some(tin), Some(name), Some(purchase_code)),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum YesNo {
    Yes,
    No,
}

impl YesNo {
    fn code(self) -> &'static str {
        match self {
            Self::Yes => "Y",
            Self::No => "N",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum PaymentMethod {
    Cash,
    Credit,
    CashCredit,
    BankCheck,
    Card,
    MobileMoney,
    Other,
}

impl PaymentMethod {
    fn code(self) -> &'static str {
        match self {
            Self::Cash => "01",
            Self::Credit => "02",
            Self::CashCredit => "03",
            Self::BankCheck => "04",
            Self::Card => "05",
            Self::MobileMoney => "06",
            Self::Other => "07",
        }
    }
}

/// Classification symbols only. Their assignment and rates must come from reviewed sources.
#[derive(Clone, Copy, Debug)]
pub(crate) enum TaxBucket {
    A,
    B,
    C,
    D,
}

impl TaxBucket {
    fn index(self) -> usize {
        match self {
            Self::A => 0,
            Self::B => 1,
            Self::C => 2,
            Self::D => 3,
        }
    }
    fn code(self) -> &'static str {
        match self {
            Self::A => "A",
            Self::B => "B",
            Self::C => "C",
            Self::D => "D",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct TaxSummary {
    pub(crate) taxable_amounts: [Amount; 4],
    pub(crate) rates: [TaxRate; 4],
    pub(crate) tax_amounts: [Amount; 4],
    pub(crate) total_taxable_amount: Amount,
    pub(crate) total_tax_amount: Amount,
    pub(crate) total_amount: Amount,
}

#[derive(Clone, Debug)]
pub(crate) struct SaleItem {
    pub(crate) item_code: String,
    pub(crate) classification_code: Option<String>,
    pub(crate) name: String,
    pub(crate) barcode: Option<String>,
    pub(crate) packaging_unit_code: String,
    pub(crate) packages: Quantity,
    pub(crate) quantity_unit_code: String,
    pub(crate) quantity: Quantity,
    pub(crate) price: Amount,
    pub(crate) supply_amount: Amount,
    pub(crate) tax_bucket: TaxBucket,
    pub(crate) taxable_amount: Amount,
    pub(crate) tax_amount: Amount,
    pub(crate) total_amount: Amount,
}

#[derive(Clone, Debug)]
pub(crate) struct SaleReceipt {
    pub(crate) report_number: Counter,
    pub(crate) customer_mobile_number: Option<String>,
    pub(crate) trade_name: Option<String>,
    pub(crate) address: Option<String>,
    pub(crate) top_message: Option<String>,
    pub(crate) bottom_message: Option<String>,
}

/// Deliberately restricted to N/S/02, original invoice zero, no discounts/insurance.
/// No rounding is performed: price×quantity must already be exact to two decimals.
#[derive(Clone, Debug)]
pub(crate) struct NormalSaleRequest {
    pub(crate) scope: DeviceScope,
    pub(crate) invoice_number: Counter,
    pub(crate) customer: Customer,
    pub(crate) payment_method: Option<PaymentMethod>,
    pub(crate) confirmed_at: String,
    pub(crate) sales_date: String,
    pub(crate) stock_released_at: Option<String>,
    pub(crate) buyer_accepted: YesNo,
    pub(crate) remark: Option<String>,
    pub(crate) registrant_name: String,
    pub(crate) registrant_id: String,
    pub(crate) modifier_name: String,
    pub(crate) modifier_id: String,
    pub(crate) taxes: TaxSummary,
    pub(crate) receipt: SaleReceipt,
    pub(crate) items: Vec<SaleItem>,
}

impl NormalSaleRequest {
    pub(super) fn validate(&self, dialect: &ReviewedSalesDialect) -> Result<(), ValidationError> {
        // Exhaustive on purpose: a future rounding option must change validation explicitly.
        match dialect.rounding_policy {
            RoundingPolicy::RejectFractionalMinorUnits => {}
        }
        self.scope.validate()?;
        if self.invoice_number.value() == 0 || self.receipt.report_number.value() == 0 {
            return Err(invalid("invoice/report number"));
        }
        let (tin, name, purchase_code) = self.customer.fields();
        if let Some(tin) = tin {
            digits(tin, 9, "custTin")?;
        }
        optional_text(name, 60, "custNm")?;
        if let Some(code) = purchase_code {
            text(code, 6, "prcOrdCd")?;
            if code.chars().count() != 6 {
                return Err(invalid("prcOrdCd"));
            }
        }
        datetime(&self.confirmed_at, "cfmDt")?;
        date(&self.sales_date, "salesDt")?;
        if let Some(value) = &self.stock_released_at {
            datetime(value, "stockRlsDt")?;
        }
        for (value, max, field) in [
            (Some(self.registrant_name.as_str()), 60, "regrNm"),
            (Some(self.registrant_id.as_str()), 20, "regrId"),
            (Some(self.modifier_name.as_str()), 60, "modrNm"),
            (Some(self.modifier_id.as_str()), 20, "modrId"),
            (self.remark.as_deref(), 400, "remark"),
            (
                self.receipt.customer_mobile_number.as_deref(),
                20,
                "custMblNo",
            ),
            (self.receipt.trade_name.as_deref(), 20, "trdeNm"),
            (self.receipt.address.as_deref(), 200, "adrs"),
            (self.receipt.top_message.as_deref(), 20, "topMsg"),
            (self.receipt.bottom_message.as_deref(), 20, "btmMsg"),
        ] {
            optional_text(value, max, field)?;
        }
        if self.items.is_empty() || self.items.len() > 999 {
            return Err(invalid("itemList"));
        }
        let mut taxable = [0_u128; 4];
        let mut tax = [0_u128; 4];
        let mut total = 0_u128;
        for item in &self.items {
            text(&item.item_code, 20, "itemCd")?;
            if let Some(code) = &item.classification_code {
                digits(code, 10, "itemClsCd")?;
            }
            text(&item.name, 200, "itemNm")?;
            optional_text(item.barcode.as_deref(), 20, "bcd")?;
            text(&item.packaging_unit_code, 5, "pkgUnitCd")?;
            text(&item.quantity_unit_code, 5, "qtyUnitCd")?;
            if item.quantity.minor_units() == 0 || item.packages.minor_units() == 0 {
                return Err(invalid("positive item quantity/package"));
            }
            let product =
                u128::from(item.price.minor_units()) * u128::from(item.quantity.minor_units());
            if product % 100 != 0 || product / 100 != u128::from(item.supply_amount.minor_units()) {
                return Err(invalid("exact item supply amount"));
            }
            if item.tax_amount > item.total_amount {
                return Err(invalid("item tax amount"));
            }
            let supply = u128::from(item.supply_amount.minor_units());
            let rate = u128::from(self.taxes.rates[item.tax_bucket.index()].minor_units());
            let (denominator, expected_total) = match dialect.amount_convention {
                AmountConvention::InclusiveExact => (10_000 + rate, supply),
                AmountConvention::ExclusiveExact => {
                    (10_000, supply + u128::from(item.tax_amount.minor_units()))
                }
            };
            let tax_numerator = supply * rate;
            if item.taxable_amount != item.supply_amount
                || tax_numerator % denominator != 0
                || tax_numerator / denominator != u128::from(item.tax_amount.minor_units())
                || expected_total != u128::from(item.total_amount.minor_units())
            {
                return Err(invalid("reviewed exact item amount convention"));
            }
            taxable[item.tax_bucket.index()] += u128::from(item.taxable_amount.minor_units());
            tax[item.tax_bucket.index()] += u128::from(item.tax_amount.minor_units());
            total += u128::from(item.total_amount.minor_units());
        }
        for i in 0..4 {
            if taxable[i] != u128::from(self.taxes.taxable_amounts[i].minor_units())
                || tax[i] != u128::from(self.taxes.tax_amounts[i].minor_units())
                || self.taxes.rates[i].minor_units() > 10_000
            {
                return Err(invalid("tax bucket totals/rates"));
            }
        }
        if taxable.iter().sum::<u128>() != u128::from(self.taxes.total_taxable_amount.minor_units())
            || tax.iter().sum::<u128>() != u128::from(self.taxes.total_tax_amount.minor_units())
            || total != u128::from(self.taxes.total_amount.minor_units())
            || total == 0
        {
            return Err(invalid("sale totals"));
        }
        Ok(())
    }

    pub(super) fn encode(
        &self,
        dialect: &ReviewedSalesDialect,
    ) -> Result<Vec<u8>, ValidationError> {
        self.validate(dialect)?;
        dialect.validate()?;
        let (tin, name, purchase_code) = self.customer.fields();
        let receipt_tin = match dialect.receipt_tin_field {
            ReceiptTinField::TableCustTIn => "custTIn",
            ReceiptTinField::ExampleCustTin => "custTin",
        };
        let item_tax = match dialect.item_tax_field {
            ItemTaxField::TableTotTaxAmt => "totTaxAmt",
            ItemTaxField::ExampleTaxAmt => "taxAmt",
        };
        let receipt = Wire::Object(vec![
            (receipt_tin, Wire::optional(tin)),
            (
                "custMblNo",
                Wire::optional(self.receipt.customer_mobile_number.as_deref()),
            ),
            ("rptNo", Wire::counter(self.receipt.report_number)),
            ("trdeNm", Wire::optional(self.receipt.trade_name.as_deref())),
            ("adrs", Wire::optional(self.receipt.address.as_deref())),
            (
                "topMsg",
                Wire::optional(self.receipt.top_message.as_deref()),
            ),
            (
                "btmMsg",
                Wire::optional(self.receipt.bottom_message.as_deref()),
            ),
            ("prchrAcptcYn", Wire::string(self.buyer_accepted.code())),
        ]);
        let items = self
            .items
            .iter()
            .enumerate()
            .map(|(i, item)| {
                Wire::Object(vec![
                    ("itemSeq", Wire::integer(i + 1)),
                    ("itemCd", Wire::string(&item.item_code)),
                    (
                        "itemClsCd",
                        Wire::optional(item.classification_code.as_deref()),
                    ),
                    ("itemNm", Wire::string(&item.name)),
                    ("bcd", Wire::optional(item.barcode.as_deref())),
                    ("pkgUnitCd", Wire::string(&item.packaging_unit_code)),
                    ("pkg", Wire::decimal(item.packages)),
                    ("qtyUnitCd", Wire::string(&item.quantity_unit_code)),
                    ("qty", Wire::decimal(item.quantity)),
                    ("prc", Wire::decimal(item.price)),
                    ("splyAmt", Wire::decimal(item.supply_amount)),
                    ("dcRt", Wire::decimal(Decimal::<5>::ZERO)),
                    ("dcAmt", Wire::decimal(Amount::ZERO)),
                    ("isrccCd", Wire::Null),
                    ("isrccNm", Wire::Null),
                    ("isrcRt", Wire::Null),
                    ("isrcAmt", Wire::Null),
                    ("taxTyCd", Wire::string(item.tax_bucket.code())),
                    ("taxblAmt", Wire::decimal(item.taxable_amount)),
                    (item_tax, Wire::decimal(item.tax_amount)),
                    ("totAmt", Wire::decimal(item.total_amount)),
                ])
            })
            .collect();
        let mut fields = vec![
            ("tin", Wire::string(&self.scope.tin)),
            ("bhfId", Wire::string(&self.scope.branch_id)),
            ("invcNo", Wire::counter(self.invoice_number)),
            ("orgInvcNo", Wire::integer(0)),
            ("custTin", Wire::optional(tin)),
            ("prcOrdCd", Wire::optional(purchase_code)),
            ("custNm", Wire::optional(name)),
            ("salesTyCd", Wire::string("N")),
            ("rcptTyCd", Wire::string("S")),
            ("salesSttsCd", Wire::string("02")),
            (
                "pmtTyCd",
                Wire::optional(self.payment_method.map(PaymentMethod::code)),
            ),
            ("cfmDt", Wire::string(&self.confirmed_at)),
            ("salesDt", Wire::string(&self.sales_date)),
            (
                "stockRlsDt",
                Wire::optional(self.stock_released_at.as_deref()),
            ),
            ("cnclReqDt", Wire::Null),
            ("cnclDt", Wire::Null),
            ("rfdDt", Wire::Null),
            ("rfdRsnCd", Wire::Null),
            ("totItemCnt", Wire::integer(self.items.len())),
        ];
        for (i, (taxable, rate, tax)) in [
            ("taxblAmtA", "taxRtA", "taxAmtA"),
            ("taxblAmtB", "taxRtB", "taxAmtB"),
            ("taxblAmtC", "taxRtC", "taxAmtC"),
            ("taxblAmtD", "taxRtD", "taxAmtD"),
        ]
        .into_iter()
        .enumerate()
        {
            fields.extend([
                (taxable, Wire::decimal(self.taxes.taxable_amounts[i])),
                (rate, Wire::decimal(self.taxes.rates[i])),
                (tax, Wire::decimal(self.taxes.tax_amounts[i])),
            ]);
        }
        fields.extend([
            (
                "totTaxblAmt",
                Wire::decimal(self.taxes.total_taxable_amount),
            ),
            ("totTaxAmt", Wire::decimal(self.taxes.total_tax_amount)),
            ("totAmt", Wire::decimal(self.taxes.total_amount)),
            ("prchrAcptcYn", Wire::string(self.buyer_accepted.code())),
            ("remark", Wire::optional(self.remark.as_deref())),
            ("regrNm", Wire::string(&self.registrant_name)),
            ("regrId", Wire::string(&self.registrant_id)),
            ("modrNm", Wire::string(&self.modifier_name)),
            ("modrId", Wire::string(&self.modifier_id)),
            ("receipt", receipt),
            ("itemList", Wire::Array(items)),
        ]);
        Wire::Object(fields)
            .encode()
            .map_err(|_| invalid("request encoding"))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SalesReceiptData {
    pub(crate) rcpt_no: Counter,
    pub(crate) intrl_data: String,
    pub(crate) rcpt_sign: String,
    pub(crate) tot_rcpt_no: Counter,
    pub(crate) vsdc_rcpt_pbct_date: String,
    pub(crate) sdc_id: String,
    pub(crate) mrc_no: String,
}

impl SalesReceiptData {
    pub(super) fn validate(&self, expected: &SalesDeviceIdentity) -> Result<(), ValidationError> {
        if self.sdc_id != expected.sdc_id || self.mrc_no != expected.mrc_no {
            return Err(invalid("sales receipt device scope"));
        }
        if self.rcpt_no.value() == 0 || self.tot_rcpt_no.value() < self.rcpt_no.value() {
            return Err(invalid("sales receipt counters"));
        }
        // The response table gives no lengths for these fields. Bound conservatively,
        // require nonempty data, and make no claim that the signature is verified here.
        text(&self.intrl_data, 4096, "intrlData")?;
        text(&self.rcpt_sign, 4096, "rcptSign")?;
        datetime(&self.vsdc_rcpt_pbct_date, "vsdcRcptPbctDate")
    }
}

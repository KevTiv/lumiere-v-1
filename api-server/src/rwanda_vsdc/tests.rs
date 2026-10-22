use super::client::{HttpReply, HttpTransport, Transport, TransportFuture};
use super::*;
use reqwest::Url;
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const LARGE: u128 = 99_999_999_999_999_999_999_999_999_999_999_999_999;

fn scope() -> DeviceScope {
    DeviceScope {
        tin: "999991130".into(),
        branch_id: "00".into(),
    }
}

fn dialect() -> ReviewedSalesDialect {
    ReviewedSalesDialect {
        installed_version: "synthetic-test-device-v1.0.5".into(),
        review_reference: "synthetic-fixture-only-not-operator-approval".into(),
        item_tax_field: ItemTaxField::ExampleTaxAmt,
        receipt_tin_field: ReceiptTinField::ExampleCustTin,
        rounding_policy: RoundingPolicy::RejectFractionalMinorUnits,
        amount_convention: AmountConvention::InclusiveExact,
    }
}

fn identity() -> SalesDeviceIdentity {
    SalesDeviceIdentity {
        sdc_id: "SDC010000005".into(),
        mrc_no: "WIS01006230".into(),
    }
}

fn config(url: &str, sales: bool) -> ClientConfig {
    let config = ClientConfig::new(url, Duration::from_secs(1), scope()).unwrap();
    if sales {
        config.with_reviewed_sales(dialect(), identity()).unwrap()
    } else {
        config
    }
}

fn init() -> InitializationRequest {
    InitializationRequest {
        scope: scope(),
        device_serial_number: "test-device".into(),
    }
}

fn sale() -> NormalSaleRequest {
    // Synthetic arithmetic fixture, not an endorsed tax classification/rate or official invoice.
    let amount = Amount::parse("0.30").unwrap();
    NormalSaleRequest {
        scope: scope(),
        invoice_number: Counter::new(LARGE).unwrap(),
        customer: Customer::Individual {
            tin: None,
            name: None,
            purchase_code: None,
        },
        payment_method: None,
        confirmed_at: "20261018120000".into(),
        sales_date: "20261018".into(),
        stock_released_at: None,
        buyer_accepted: YesNo::No,
        remark: None,
        registrant_name: "Test".into(),
        registrant_id: "test-actor".into(),
        modifier_name: "Test".into(),
        modifier_id: "test-actor".into(),
        taxes: TaxSummary {
            taxable_amounts: [amount, Amount::ZERO, Amount::ZERO, Amount::ZERO],
            rates: [TaxRate::ZERO; 4],
            tax_amounts: [Amount::ZERO; 4],
            total_taxable_amount: amount,
            total_tax_amount: Amount::ZERO,
            total_amount: amount,
        },
        receipt: SaleReceipt {
            report_number: Counter::new(LARGE).unwrap(),
            customer_mobile_number: None,
            trade_name: None,
            address: None,
            top_message: None,
            bottom_message: None,
        },
        items: vec![SaleItem {
            item_code: "SYNTHETIC".into(),
            classification_code: None,
            name: "Test item".into(),
            barcode: None,
            packaging_unit_code: "NT".into(),
            packages: Quantity::parse("1").unwrap(),
            quantity_unit_code: "U".into(),
            quantity: Quantity::parse("1").unwrap(),
            price: amount,
            supply_amount: amount,
            tax_bucket: TaxBucket::A,
            taxable_amount: amount,
            tax_amount: Amount::ZERO,
            total_amount: amount,
        }],
    }
}

fn init_body(tin: &str, branch: &str) -> Vec<u8> {
    format!(r#"{{"resultCd":"000","resultMsg":"ok","resultDt":"20261018120000","data":{{"info":{{"tin":"{tin}","bhfId":"{branch}","dvcId":"test-device-id","sdcId":null,"mrcNo":null,"intrlKey":"never-log-me","lastSaleInvcNo":{LARGE}}}}}}}"#).into_bytes()
}

fn receipt_body(sdc: &str) -> Vec<u8> {
    format!(r#"{{"resultCd":"000","resultMsg":"ok","resultDt":"20261018120000","data":{{"rcptNo":{LARGE},"intrlData":"opaque-test-data","rcptSign":"opaque-test-signature","totRcptNo":{LARGE},"vsdcRcptPbctDate":"20261018120000","sdcId":"{sdc}","mrcNo":"WIS01006230"}}}}"#).into_bytes()
}

#[derive(Clone)]
struct MockTransport {
    calls: Arc<Mutex<Vec<(Url, Vec<u8>)>>>,
    response: Arc<Mutex<Option<Result<HttpReply, UncertainReason>>>>,
}

impl MockTransport {
    fn new(response: Result<HttpReply, UncertainReason>) -> Self {
        Self {
            calls: Arc::default(),
            response: Arc::new(Mutex::new(Some(response))),
        }
    }

    fn ok(body: Vec<u8>) -> Self {
        Self::new(Ok(HttpReply { status: 200, body }))
    }

    fn count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

impl Transport for MockTransport {
    fn post(&self, url: Url, body: Vec<u8>) -> TransportFuture<'_> {
        self.calls.lock().unwrap().push((url, body));
        let response = self
            .response
            .lock()
            .unwrap()
            .take()
            .expect("no automatic retry");
        Box::pin(async move { response })
    }
}

#[test]
fn decimals_reject_non_decimal_or_out_of_scale_and_keep_boundaries_exact() {
    for input in [
        "", "-1", "+1", "NaN", "Infinity", "1e2", "0.001", "1.", ".1", " 1", "1 0", "1,00",
    ] {
        assert!(Amount::parse(input).is_err(), "{input}");
    }
    assert_eq!(
        Amount::parse("9999999999999999.99").unwrap().to_string(),
        "9999999999999999.99"
    );
    assert!(Amount::parse("10000000000000000").is_err());
    assert_eq!(
        Quantity::parse("99999999999.99").unwrap().minor_units(),
        9_999_999_999_999
    );
    assert!(Quantity::parse("100000000000").is_err());
    assert_eq!(Amount::parse("0.1").unwrap().to_string(), "0.10");
}

#[test]
fn typed_38_digit_counter_decode_never_uses_float_or_value() {
    assert_eq!(
        serde_json::from_str::<Counter>(&LARGE.to_string())
            .unwrap()
            .value(),
        LARGE
    );
    for value in [
        format!("\"{LARGE}\""),
        "1.0".into(),
        "1e2".into(),
        "-1".into(),
        10_u128.pow(38).to_string(),
    ] {
        assert!(serde_json::from_str::<Counter>(&value).is_err(), "{value}");
    }
}

#[test]
fn sales_wire_preserves_exact_numeric_tokens_and_escapes_untrusted_strings() {
    let mut sale = sale();
    let amount = Amount::parse("90071992547409.91").unwrap();
    sale.items[0].price = amount;
    sale.items[0].supply_amount = amount;
    sale.items[0].taxable_amount = amount;
    sale.items[0].total_amount = amount;
    sale.taxes.taxable_amounts[0] = amount;
    sale.taxes.total_taxable_amount = amount;
    sale.taxes.total_amount = amount;
    sale.items[0].name = "quote\"slash\\ brace},\"totAmt\":0".into();
    let bytes = sale.encode(&dialect()).unwrap();
    let raw = std::str::from_utf8(&bytes).unwrap();
    assert!(raw.contains(&format!("\"invcNo\":{LARGE}")));
    assert!(raw.contains(&format!("\"rptNo\":{LARGE}")));
    assert!(raw.contains("\"prc\":90071992547409.91"));
    assert!(raw.contains("\"pmtTyCd\":null")); // No silent CASH default.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CountersOnly {
        invc_no: Counter,
        receipt: ReportOnly,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ReportOnly {
        rpt_no: Counter,
    }
    let decoded: CountersOnly = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(decoded.invc_no.value(), LARGE);
    assert_eq!(decoded.receipt.rpt_no.value(), LARGE);
    assert!(raw.contains("quote\\\"slash\\\\ brace},\\\"totAmt\\\":0"));
}

#[test]
fn wire_dialect_is_explicit_and_emits_one_spelling_only() {
    let sale = sale();
    let mut reviewed = dialect();
    reviewed.item_tax_field = ItemTaxField::TableTotTaxAmt;
    reviewed.receipt_tin_field = ReceiptTinField::TableCustTIn;
    let raw = String::from_utf8(sale.encode(&reviewed).unwrap()).unwrap();
    // There is a header totTaxAmt and exactly one item totTaxAmt, no item taxAmt.
    assert_eq!(raw.matches("\"totTaxAmt\":").count(), 2);
    assert!(!raw.contains("\"taxAmt\":"));
    assert!(raw.contains("\"receipt\":{\"custTIn\":"));
    reviewed.review_reference.clear();
    assert!(sale.encode(&reviewed).is_err());
}

#[tokio::test]
async fn invalid_requests_are_rejected_before_any_transport_call() {
    let transport = MockTransport::ok(receipt_body("SDC010000005"));
    let client = VsdcClient::with_transport(
        config("http://operator.invalid/prefix", true),
        transport.clone(),
    );
    let mut cases = Vec::new();
    let mut s = sale();
    s.confirmed_at = "20260230120000".into();
    cases.push(s);
    let mut s = sale();
    s.confirmed_at = "20261018120060".into();
    cases.push(s);
    let mut s = sale();
    s.sales_date = "00000101".into();
    cases.push(s);
    let mut s = sale();
    s.confirmed_at = "00000101120000".into();
    cases.push(s);
    let mut s = sale();
    s.scope.branch_id = "01".into();
    cases.push(s);
    let mut s = sale();
    s.taxes.total_amount = Amount::parse("0.31").unwrap();
    cases.push(s);
    let mut s = sale();
    s.customer = Customer::Business {
        tin: "123456789".into(),
        name: "Business".into(),
        purchase_code: "".into(),
    };
    cases.push(s);
    let mut s = sale();
    s.items.clear();
    cases.push(s);
    let mut s = sale();
    s.items[0].quantity = Quantity::parse("0.01").unwrap();
    cases.push(s);
    let mut s = sale();
    s.items[0].name = "x".repeat(201);
    cases.push(s);
    let mut s = sale();
    s.invoice_number = Counter::new(0).unwrap();
    cases.push(s);
    let mut s = sale();
    s.items[0].total_amount = Amount::parse("999.00").unwrap();
    s.taxes.total_amount = Amount::parse("999.00").unwrap();
    cases.push(s);
    for sale in cases {
        assert!(matches!(
            client.save_normal_sale(&sale).await,
            Err(VsdcError::Invalid(_))
        ));
    }
    let mut request = init();
    request.device_serial_number.clear();
    assert!(matches!(
        client.initialize(&request).await,
        Err(VsdcError::Invalid(_))
    ));
    assert_eq!(transport.count(), 0);
}

#[tokio::test]
async fn reviewed_amount_conventions_validate_tax_and_reject_unreviewed_rounding_before_io() {
    for convention in [
        AmountConvention::InclusiveExact,
        AmountConvention::ExclusiveExact,
    ] {
        let mut request = sale();
        let supply = match convention {
            AmountConvention::InclusiveExact => Amount::parse("118").unwrap(),
            AmountConvention::ExclusiveExact => Amount::parse("100").unwrap(),
        };
        let total = Amount::parse("118").unwrap();
        let tax = Amount::parse("18").unwrap();
        request.items[0].price = supply;
        request.items[0].supply_amount = supply;
        request.items[0].taxable_amount = supply;
        request.items[0].total_amount = total;
        request.items[0].tax_amount = tax;
        request.taxes.taxable_amounts[0] = supply;
        request.taxes.tax_amounts[0] = tax;
        request.taxes.rates[0] = TaxRate::parse("18").unwrap();
        request.taxes.total_taxable_amount = supply;
        request.taxes.total_tax_amount = tax;
        request.taxes.total_amount = total;
        let mut reviewed = dialect();
        reviewed.amount_convention = convention;
        let cfg = ClientConfig::new("http://operator.invalid", Duration::from_secs(1), scope())
            .unwrap()
            .with_reviewed_sales(reviewed, identity())
            .unwrap();
        let transport = MockTransport::ok(receipt_body("SDC010000005"));
        let client = VsdcClient::with_transport(cfg, transport.clone());
        assert!(client.save_normal_sale(&request).await.is_ok());
        assert_eq!(transport.count(), 1);

        // Coherently altered aggregate tax is still rejected by per-line reviewed arithmetic.
        request.items[0].tax_amount = Amount::parse("17").unwrap();
        request.taxes.tax_amounts[0] = Amount::parse("17").unwrap();
        request.taxes.total_tax_amount = Amount::parse("17").unwrap();
        assert!(matches!(
            client.save_normal_sale(&request).await,
            Err(VsdcError::Invalid(_))
        ));
        assert_eq!(transport.count(), 1);
    }
    let mut request = sale();
    request.taxes.rates[0] = TaxRate::parse("18").unwrap();
    // 0.30 inclusive at 18% cannot yield an exact integer tax cent: no rounding is guessed.
    let transport = MockTransport::ok(receipt_body("SDC010000005"));
    let client =
        VsdcClient::with_transport(config("http://operator.invalid", true), transport.clone());
    assert!(matches!(
        client.save_normal_sale(&request).await,
        Err(VsdcError::Invalid(_))
    ));
    assert_eq!(transport.count(), 0);
}

#[tokio::test]
async fn sales_without_reviewed_device_configuration_are_not_dispatched() {
    let transport = MockTransport::ok(receipt_body("SDC010000005"));
    let client =
        VsdcClient::with_transport(config("http://operator.invalid", false), transport.clone());
    assert_eq!(
        client.save_normal_sale(&sale()).await.unwrap_err(),
        VsdcError::SalesNotConfigured
    );
    assert_eq!(transport.count(), 0);
}

#[tokio::test]
async fn initialization_is_typed_scoped_and_redacts_key_material() {
    let transport = MockTransport::ok(init_body("999991130", "00"));
    let client = VsdcClient::with_transport(
        config("http://operator.invalid/device-prefix", false),
        transport.clone(),
    );
    let result = client.initialize(&init()).await.unwrap();
    assert_eq!(result.info.last_sale_invc_no.unwrap().value(), LARGE);
    assert!(!format!("{result:?}").contains("never-log-me"));
    let calls = transport.calls.lock().unwrap();
    assert_eq!(
        calls[0].0.as_str(),
        "http://operator.invalid/device-prefix/initializer/selectInitInfo"
    );
    assert_eq!(
        calls[0].1,
        br#"{"tin":"999991130","bhfId":"00","dvcSrlNo":"test-device"}"#
    );
}

#[tokio::test]
async fn successful_looking_responses_with_wrong_scope_are_uncertain() {
    for response in [init_body("999991131", "00"), init_body("999991130", "01")] {
        let transport = MockTransport::ok(response);
        let client =
            VsdcClient::with_transport(config("http://operator.invalid", false), transport.clone());
        assert_eq!(
            client.initialize(&init()).await.unwrap_err(),
            VsdcError::Uncertain(UncertainReason::InconsistentResponse)
        );
        assert_eq!(transport.count(), 1);
    }
    let transport = MockTransport::ok(receipt_body("SDC010000006"));
    let client =
        VsdcClient::with_transport(config("http://operator.invalid", true), transport.clone());
    assert_eq!(
        client.save_normal_sale(&sale()).await.unwrap_err(),
        VsdcError::Uncertain(UncertainReason::InconsistentResponse)
    );
    assert_eq!(transport.count(), 1);
}

#[tokio::test]
async fn receipt_success_keeps_38_digit_counters_and_only_promises_device_scope() {
    let transport = MockTransport::ok(receipt_body("SDC010000005"));
    let client =
        VsdcClient::with_transport(config("http://operator.invalid", true), transport.clone());
    let response = client.save_normal_sale(&sale()).await.unwrap();
    assert_eq!(response.rcpt_no.value(), LARGE);
    assert_eq!(transport.count(), 1);
    assert_eq!(
        transport.calls.lock().unwrap()[0].0.path(),
        "/trnsSales/saveSales"
    );
}

#[tokio::test]
async fn timeout_http_errors_and_malformed_success_are_uncertain_without_retry() {
    let cases = [
        (Err(UncertainReason::Timeout), UncertainReason::Timeout),
        (Err(UncertainReason::Transport), UncertainReason::Transport),
        (Ok(HttpReply {status:503, body:b"secret provider error".to_vec()}), UncertainReason::HttpStatus(503)),
        (Ok(HttpReply {status:429, body:Vec::new()}), UncertainReason::HttpStatus(429)),
        (Ok(HttpReply {status:200, body:b"not json secret".to_vec()}), UncertainReason::MalformedResponse),
        (Ok(HttpReply {status:200, body:br#"{"resultCd":"000","resultMsg":"secret","resultDt":"20261018120000","data":null}"#.to_vec()}), UncertainReason::MalformedResponse),
        (Ok(HttpReply {status:200, body:br#"{"resultCd":"000","resultMsg":"secret","resultDt":"20261018120000","data":{}}"#.to_vec()}), UncertainReason::MalformedResponse),
        (Ok(HttpReply {status:200, body:br#"{"resultCd":"secret","resultMsg":"secret","resultDt":"20261018120000","data":null}"#.to_vec()}), UncertainReason::MalformedResponse),
        (Ok(HttpReply {status:200, body:br#"{"resultCd":"000","resultCd":"994","resultMsg":"secret","resultDt":"20261018120000","data":null}"#.to_vec()}), UncertainReason::MalformedResponse),
        (Ok(HttpReply {status:200, body:vec![b'x'; 256*1024+1]}), UncertainReason::ResponseTooLarge),
    ];
    for (response, expected) in cases {
        let transport = MockTransport::new(response);
        let client =
            VsdcClient::with_transport(config("http://operator.invalid", true), transport.clone());
        let error = client.save_normal_sale(&sale()).await.unwrap_err();
        assert_eq!(error, VsdcError::Uncertain(expected));
        assert!(!format!("{error:?} {error}").contains("secret"));
        assert_eq!(transport.count(), 1);
    }
}

#[tokio::test]
async fn provider_overlap_and_communication_codes_are_never_idempotent_success() {
    for code in ["994", "894", "999", "001", "883"] {
        let body = format!(r#"{{"resultCd":"{code}","resultMsg":"SECRET","resultDt":"20261018120000","data":null}}"#).into_bytes();
        let transport = MockTransport::ok(body);
        let client =
            VsdcClient::with_transport(config("http://operator.invalid", true), transport.clone());
        let error = client.save_normal_sale(&sale()).await.unwrap_err();
        assert_eq!(
            error,
            VsdcError::Uncertain(UncertainReason::ProviderCode(code.into()))
        );
        assert!(!format!("{error:?}").contains("SECRET"));
        assert_eq!(transport.count(), 1);
    }
}

#[tokio::test]
async fn entire_transport_operation_has_a_deadline_without_redispatch() {
    struct NeverReturns(Arc<std::sync::atomic::AtomicUsize>);
    impl Transport for NeverReturns {
        fn post(&self, _: Url, _: Vec<u8>) -> TransportFuture<'_> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Box::pin(std::future::pending())
        }
    }
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let cfg = ClientConfig::new(
        "http://operator.invalid",
        Duration::from_millis(10),
        scope(),
    )
    .unwrap();
    let client = VsdcClient::with_transport(cfg, NeverReturns(calls.clone()));
    assert_eq!(
        client.initialize(&init()).await.unwrap_err(),
        VsdcError::Uncertain(UncertainReason::Timeout)
    );
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn operator_url_and_timeout_have_no_guessed_defaults_or_credentials() {
    for url in [
        "",
        "operator.invalid",
        "ftp://operator.invalid",
        "http://u:p@operator.invalid",
        "https://operator.invalid/?secret=x",
        "https://operator.invalid/#x",
    ] {
        assert!(
            ClientConfig::new(url, Duration::from_secs(1), scope()).is_err(),
            "{url}"
        );
    }
    assert!(ClientConfig::new("http://127.0.0.1:8080", Duration::ZERO, scope()).is_err());
    assert!(ClientConfig::new("http://127.0.0.1:8080", Duration::from_secs(61), scope()).is_err());
}

/// Real loopback HTTP exercises reqwest's request bytes, redirects and response bounds.
async fn http_fixture(reply: Vec<u8>) -> (String, tokio::task::JoinHandle<Vec<u8>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut expected = None;
        loop {
            let mut buffer = [0_u8; 4096];
            let read = socket.read(&mut buffer).await.unwrap();
            if read == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..read]);
            if expected.is_none() {
                if let Some(end) = request.windows(4).position(|s| s == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&request[..end]);
                    let length: usize = header
                        .lines()
                        .find_map(|line| {
                            let (key, val) = line.split_once(':')?;
                            key.eq_ignore_ascii_case("content-length")
                                .then(|| val.trim().parse().unwrap())
                        })
                        .unwrap();
                    expected = Some(end + 4 + length);
                }
            }
            if expected.is_some_and(|len| request.len() >= len) {
                break;
            }
        }
        socket.write_all(&reply).await.unwrap();
        request
    });
    (format!("http://{address}/prefix/"), task)
}

#[tokio::test]
async fn real_http_sends_typed_json_without_auth_and_does_not_follow_redirects() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let reply = b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/should-not-follow\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec();
    let (url, task) = http_fixture(reply).await;
    let client = VsdcClient::<HttpTransport>::new(config(&url, true)).unwrap();
    assert_eq!(
        client.save_normal_sale(&sale()).await.unwrap_err(),
        VsdcError::Uncertain(UncertainReason::HttpStatus(302))
    );
    let raw = String::from_utf8(task.await.unwrap()).unwrap();
    assert!(raw.starts_with("POST /prefix/trnsSales/saveSales HTTP/1.1\r\n"));
    assert!(raw
        .to_ascii_lowercase()
        .contains("content-type: application/json"));
    assert!(!raw.to_ascii_lowercase().contains("authorization:"));
    assert!(raw.contains(&format!("\"invcNo\":{LARGE}")));
    assert!(raw.contains("\"prc\":0.30"));
}

#[tokio::test]
async fn real_http_rejects_declared_and_streamed_oversized_bodies() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    for reply in [
        b"HTTP/1.1 200 OK\r\nContent-Length: 999999\r\nConnection: close\r\n\r\n".to_vec(),
        {
            let payload = vec![b'x'; 256 * 1024 + 1];
            let mut reply = format!("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n", payload.len()).into_bytes();
            reply.extend(payload);
            reply.extend_from_slice(b"\r\n0\r\n\r\n");
            reply
        },
    ] {
        let (url, task) = http_fixture(reply).await;
        let client = VsdcClient::new(config(&url, false)).unwrap();
        assert_eq!(
            client.initialize(&init()).await.unwrap_err(),
            VsdcError::Uncertain(UncertainReason::ResponseTooLarge)
        );
        task.await.unwrap();
    }
}

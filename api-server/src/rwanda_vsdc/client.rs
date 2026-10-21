use super::protocol::{
    InitializationData, InitializationRequest, NormalSaleRequest, ReviewedSalesDialect,
    SalesDeviceIdentity, SalesReceiptData,
};
use super::values::{datetime, digits, invalid};
use super::{DeviceScope, ValidationError};
use reqwest::{redirect, Url};
use serde::{de::DeserializeOwned, Deserialize};
use std::{future::Future, pin::Pin, time::Duration};

const INIT_PATH: &str = "initializer/selectInitInfo";
const SALES_PATH: &str = "trnsSales/saveSales";
const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_TIMEOUT: Duration = Duration::from_secs(60);

/// Supplied by an operator-controlled integration, never from an end-user request.
/// No endpoint, scheme, credentials or installed version is guessed by this module.
pub(crate) struct ClientConfig {
    base_url: Url,
    timeout: Duration,
    scope: DeviceScope,
    sales: Option<(ReviewedSalesDialect, SalesDeviceIdentity)>,
}

impl ClientConfig {
    pub(crate) fn new(
        operator_url: &str,
        timeout: Duration,
        scope: DeviceScope,
    ) -> Result<Self, ValidationError> {
        let mut base_url = Url::parse(operator_url).map_err(|_| invalid("operator URL"))?;
        if !matches!(base_url.scheme(), "http" | "https")
            || base_url.host_str().is_none()
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
            || timeout.is_zero()
            || timeout > MAX_TIMEOUT
        {
            return Err(invalid("operator URL/timeout"));
        }
        // A deployment prefix is permitted; endpoints remain underneath that exact prefix.
        if !base_url.path().ends_with('/') {
            base_url.set_path(&format!("{}/", base_url.path()));
        }
        scope.validate()?;
        Ok(Self {
            base_url,
            timeout,
            scope,
            sales: None,
        })
    }

    pub(crate) fn with_reviewed_sales(
        mut self,
        dialect: ReviewedSalesDialect,
        identity: SalesDeviceIdentity,
    ) -> Result<Self, ValidationError> {
        dialect.validate()?;
        identity.validate()?;
        self.sales = Some((dialect, identity));
        Ok(self)
    }
}

/// Every failure after handing a request to the transport is uncertain. In particular,
/// overlap (994), communication (894) and unknown (999) are never replay-safe success.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum UncertainReason {
    Transport,
    Timeout,
    HttpStatus(u16),
    ResponseTooLarge,
    MalformedResponse,
    InconsistentResponse,
    ProviderCode(String),
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub(crate) enum VsdcError {
    #[error("{0}")]
    Invalid(#[from] ValidationError),
    #[error("VSDC transport configuration unavailable")]
    Configuration,
    #[error("VSDC sales require reviewed installed-device configuration")]
    SalesNotConfigured,
    #[error("VSDC request exceeds local limit")]
    RequestTooLarge,
    #[error("VSDC outcome uncertain; reconcile before any further submission")]
    Uncertain(UncertainReason),
}

pub(crate) struct HttpReply {
    pub(super) status: u16,
    pub(super) body: Vec<u8>,
}

pub(crate) type TransportFuture<'a> =
    Pin<Box<dyn Future<Output = Result<HttpReply, UncertainReason>> + Send + 'a>>;

pub(crate) trait Transport: Send + Sync {
    fn post(&self, url: Url, body: Vec<u8>) -> TransportFuture<'_>;
}

pub(crate) struct HttpTransport {
    client: reqwest::Client,
}

impl HttpTransport {
    fn new(timeout: Duration) -> Result<Self, VsdcError> {
        let client = reqwest::Client::builder()
            .redirect(redirect::Policy::none())
            .retry(reqwest::retry::never())
            .referer(false)
            .timeout(timeout)
            .connect_timeout(timeout.min(Duration::from_secs(10)))
            .build()
            .map_err(|_| VsdcError::Configuration)?;
        Ok(Self { client })
    }
}

impl Transport for HttpTransport {
    fn post(&self, url: Url, body: Vec<u8>) -> TransportFuture<'_> {
        Box::pin(async move {
            let mut response = self
                .client
                .post(url)
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .header(reqwest::header::ACCEPT, "application/json")
                .body(body)
                .send()
                .await
                .map_err(|err| {
                    if err.is_timeout() {
                        UncertainReason::Timeout
                    } else {
                        UncertainReason::Transport
                    }
                })?;
            let status = response.status().as_u16();
            if !(200..300).contains(&status) {
                // Never read or expose provider error bodies or redirect locations.
                return Err(UncertainReason::HttpStatus(status));
            }
            if response
                .content_length()
                .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
            {
                return Err(UncertainReason::ResponseTooLarge);
            }
            let mut body = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|err| {
                if err.is_timeout() {
                    UncertainReason::Timeout
                } else {
                    UncertainReason::Transport
                }
            })? {
                if chunk.len() > MAX_RESPONSE_BYTES.saturating_sub(body.len()) {
                    return Err(UncertainReason::ResponseTooLarge);
                }
                body.extend_from_slice(&chunk);
            }
            Ok(HttpReply { status, body })
        })
    }
}

pub(crate) struct VsdcClient<T = HttpTransport> {
    config: ClientConfig,
    transport: T,
}

impl VsdcClient<HttpTransport> {
    pub(crate) fn new(config: ClientConfig) -> Result<Self, VsdcError> {
        let transport = HttpTransport::new(config.timeout)?;
        Ok(Self { config, transport })
    }
}

impl<T: Transport> VsdcClient<T> {
    #[cfg(test)]
    pub(super) fn with_transport(config: ClientConfig, transport: T) -> Self {
        Self { config, transport }
    }

    /// No retry, counter reservation or durable dispatch intent is performed here.
    pub(crate) async fn initialize(
        &self,
        request: &InitializationRequest,
    ) -> Result<InitializationData, VsdcError> {
        if request.scope != self.config.scope {
            return Err(invalid("configured device scope").into());
        }
        let body = request.encode()?;
        let data: InitializationData = self.send(INIT_PATH, body).await?;
        data.info
            .validate(&request.scope)
            .map_err(|_| VsdcError::Uncertain(UncertainReason::InconsistentResponse))?;
        Ok(data)
    }

    /// Only sends a validated normal sale under an explicitly reviewed dialect.
    /// A returned receipt is not a verified signature or an invoice-level readback proof.
    pub(crate) async fn save_normal_sale(
        &self,
        request: &NormalSaleRequest,
    ) -> Result<SalesReceiptData, VsdcError> {
        if request.scope != self.config.scope {
            return Err(invalid("configured device scope").into());
        }
        let (dialect, identity) = self
            .config
            .sales
            .as_ref()
            .ok_or(VsdcError::SalesNotConfigured)?;
        let body = request.encode(dialect)?;
        let data: SalesReceiptData = self.send(SALES_PATH, body).await?;
        data.validate(identity)
            .map_err(|_| VsdcError::Uncertain(UncertainReason::InconsistentResponse))?;
        Ok(data)
    }

    async fn send<R: DeserializeOwned>(
        &self,
        endpoint: &'static str,
        body: Vec<u8>,
    ) -> Result<R, VsdcError> {
        if body.len() > MAX_REQUEST_BYTES {
            return Err(VsdcError::RequestTooLarge);
        }
        let url = self
            .config
            .base_url
            .join(endpoint)
            .map_err(|_| VsdcError::Configuration)?;
        // This outer bound also covers a non-HTTP/mock transport and the whole response read.
        let reply = tokio::time::timeout(self.config.timeout, self.transport.post(url, body))
            .await
            .map_err(|_| VsdcError::Uncertain(UncertainReason::Timeout))?
            .map_err(VsdcError::Uncertain)?;
        if !(200..300).contains(&reply.status) {
            return Err(VsdcError::Uncertain(UncertainReason::HttpStatus(
                reply.status,
            )));
        }
        if reply.body.len() > MAX_RESPONSE_BYTES {
            return Err(VsdcError::Uncertain(UncertainReason::ResponseTooLarge));
        }
        let envelope: Envelope<R> = serde_json::from_slice(&reply.body)
            .map_err(|_| VsdcError::Uncertain(UncertainReason::MalformedResponse))?;
        if digits(&envelope.result_cd, 3, "resultCd").is_err()
            || datetime(&envelope.result_dt, "resultDt").is_err()
        {
            return Err(VsdcError::Uncertain(UncertainReason::MalformedResponse));
        }
        if envelope.result_cd != "000" {
            return Err(VsdcError::Uncertain(UncertainReason::ProviderCode(
                envelope.result_cd,
            )));
        }
        envelope
            .data
            .ok_or(VsdcError::Uncertain(UncertainReason::MalformedResponse))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope<T> {
    result_cd: String,
    // Required protocol shape, deliberately never forwarded to errors/logging.
    result_msg: String,
    result_dt: String,
    data: Option<T>,
}

use std::fmt;

use serde::Serialize;

pub const UPSTREAM_FAILURE_CATEGORY_NETWORK: &str = "network";
pub const UPSTREAM_HTTP_NOT_FOUND: &str = "http.not_found";

pub const UPSTREAM_NETWORK_TIMEOUT: &str = "network.timeout";
pub const UPSTREAM_NETWORK_CONNECT_FAILED: &str = "network.connect_failed";
pub const UPSTREAM_NETWORK_PROXY_FAILED: &str = "network.proxy_failed";
pub const UPSTREAM_NETWORK_DNS_FAILED: &str = "network.dns_failed";
pub const UPSTREAM_NETWORK_TLS_FAILED: &str = "network.tls_failed";
pub const UPSTREAM_NETWORK_BODY_INTERRUPTED: &str = "network.body_interrupted";
pub const UPSTREAM_NETWORK_REDIRECT_REJECTED: &str = "network.redirect_rejected";
pub const UPSTREAM_NETWORK_REQUEST_FAILED: &str = "network.request_failed";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UpstreamFailure {
    pub code: String,
    pub category: String,
    pub endpoint: Option<String>,
    pub message_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_message: Option<String>,
}

impl UpstreamFailure {
    pub fn network(
        code: impl Into<String>,
        endpoint: Option<String>,
        message_key: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            category: UPSTREAM_FAILURE_CATEGORY_NETWORK.to_string(),
            endpoint,
            message_key: message_key.into(),
            provider_message: None,
        }
    }

    pub fn http_not_found(endpoint: Option<String>, provider_message: String) -> Self {
        Self {
            code: UPSTREAM_HTTP_NOT_FOUND.to_string(),
            category: "http".to_string(),
            endpoint,
            message_key: "tauritavern.error.http.not_found".to_string(),
            provider_message: Some(provider_message),
        }
    }

    pub fn fallback_message(&self) -> &'static str {
        match self.code.as_str() {
            UPSTREAM_NETWORK_TIMEOUT => {
                "The request timed out before the target service responded."
            }
            UPSTREAM_NETWORK_CONNECT_FAILED => "Could not connect to the target service.",
            UPSTREAM_NETWORK_PROXY_FAILED => "Could not connect through the configured proxy.",
            UPSTREAM_NETWORK_DNS_FAILED => "Could not find the target service address.",
            UPSTREAM_NETWORK_TLS_FAILED => "Could not establish a secure connection.",
            UPSTREAM_NETWORK_BODY_INTERRUPTED => {
                "The response was interrupted while it was being read."
            }
            UPSTREAM_NETWORK_REDIRECT_REJECTED => "The endpoint redirect was rejected.",
            UPSTREAM_NETWORK_REQUEST_FAILED => "Network request failed.",
            UPSTREAM_HTTP_NOT_FOUND => "The API service returned HTTP 404 for this endpoint.",
            _ => "Upstream request failed.",
        }
    }
}

impl fmt::Display for UpstreamFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.fallback_message())?;
        if let Some(message) = self.provider_message.as_deref() {
            write!(formatter, " {message}")?;
        }
        match self.endpoint.as_deref() {
            Some(endpoint) if !endpoint.is_empty() => {
                write!(formatter, " ({endpoint})")
            }
            _ => Ok(()),
        }
    }
}

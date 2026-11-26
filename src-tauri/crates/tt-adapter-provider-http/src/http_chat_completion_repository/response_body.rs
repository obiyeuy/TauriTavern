use std::fmt::Display;

use reqwest::Response;
use reqwest::StatusCode;
use reqwest::header::CONTENT_TYPE;
use serde_json::Value;

use tt_domain::errors::DomainError;

use super::context_overflow::context_overflow_or;

/// Maximum number of bytes from a non-JSON upstream body to capture in the
/// diagnostic log. Anything larger is truncated; the full `body_len` is still
/// emitted so log readers know how much was elided.
pub(super) const BODY_PREVIEW_BYTES: usize = 512;

/// Emit a structured `error!` event describing why a chat-completion upstream
/// body could not be parsed as JSON. Always truncates the body to
/// [`BODY_PREVIEW_BYTES`] so we don't blow up the log pipeline on huge HTML
/// challenges, plain-text errors, or runaway bodies.
pub(super) fn log_upstream_body_parse_failure(
    provider_name: &str,
    operation: &str,
    status: StatusCode,
    content_type: &str,
    body: &[u8],
    error: &impl Display,
) {
    let body_len = body.len();
    let body_preview = body_preview_string(body);

    tracing::error!(
        provider = provider_name,
        operation = operation,
        status = status.as_u16(),
        content_type = content_type,
        body_len,
        body_preview = %body_preview,
        error = %error,
        "upstream returned non-JSON body for chat completion",
    );
}

/// Lossy UTF-8 preview of the first [`BODY_PREVIEW_BYTES`] of a body.
pub(super) fn body_preview_string(body: &[u8]) -> String {
    let preview_bytes = &body[..body.len().min(BODY_PREVIEW_BYTES)];
    String::from_utf8_lossy(preview_bytes).into_owned()
}

/// Read an upstream HTTP response body and parse it as JSON, logging a
/// detailed diagnostic event on failure. Callers should classify explicit HTTP
/// error statuses before invoking this helper; this path is for responses whose
/// body was expected to carry the provider JSON contract.
///
/// Both body-read failures and JSON-decode failures are reported as
/// [`DomainError::Transient`] tagged with `model.upstream_invalid_response`,
/// because in practice they are caused by upstream-side hiccups (CDN
/// challenges, proxy timeouts mid-body, plain-text 200 errors) that are worth
/// retrying rather than tearing the run down as a fatal `agent.internal_error`.
pub(super) async fn read_upstream_json_body(
    provider_name: &str,
    operation: &str,
    response: Response,
) -> Result<Value, DomainError> {
    let status = response.status();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let endpoint = response.url().clone();

    let body = response.bytes().await.map_err(|error| {
        let failure = crate::http_error::reqwest_body_failure(&error, Some(&endpoint));
        tracing::warn!(
            provider = provider_name,
            operation = operation,
            status = status.as_u16(),
            code = %failure.code,
            category = %failure.category,
            endpoint = failure.endpoint.as_deref().unwrap_or(""),
            timeout = error.is_timeout(),
            connect = error.is_connect(),
            body = error.is_body(),
            request = error.is_request(),
            "upstream response body read failed",
        );
        DomainError::upstream_failure(failure)
    })?;

    parse_upstream_json_body(
        provider_name,
        operation,
        status,
        &content_type,
        body.as_ref(),
    )
}

pub(super) fn parse_upstream_json_body(
    provider_name: &str,
    operation: &str,
    status: StatusCode,
    content_type: &str,
    body: &[u8],
) -> Result<Value, DomainError> {
    match serde_json::from_slice::<Value>(body) {
        Ok(value) => match provider_error(&value) {
            Some(error) => {
                let failure = context_overflow_or(
                    error,
                    format!("{provider_name}: {}", provider_error_message(error, &value)),
                    DomainError::InvalidData,
                );
                tracing::warn!(
                    provider = provider_name,
                    operation = operation,
                    status = status.as_u16(),
                    content_type = content_type,
                    body_len = body.len(),
                    error = %failure,
                    "upstream returned provider error in successful JSON response",
                );
                Err(failure)
            }
            None => Ok(value),
        },
        Err(error) => {
            log_upstream_body_parse_failure(
                provider_name,
                operation,
                status,
                content_type,
                body,
                &error,
            );
            Err(DomainError::transient(format!(
                "model.upstream_invalid_response: {provider_name} returned status {} non-JSON body ({operation}): {error}",
                status.as_u16()
            )))
        }
    }
}

/// Provider-declared errors can arrive in a successful HTTP response.
pub(super) fn provider_error(value: &Value) -> Option<&Value> {
    value
        .get("error")
        .or_else(|| value.pointer("/detail/error"))
        .filter(|error| !error.is_null() && **error != Value::Bool(false))
}

pub(super) fn provider_error_message(error: &Value, envelope: &Value) -> String {
    let message = if error.is_string() {
        error
    } else {
        error
            .get("message")
            .or_else(|| envelope.get("message"))
            .or_else(|| error.get("code"))
            .or_else(|| error.get("type"))
            .unwrap_or(error)
    };
    message
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| message.to_string())
}

#[cfg(test)]
mod tests {
    use super::super::test_support::CaptureDiagnostics;
    use super::*;

    #[test]
    fn json_provider_error_preserves_http_diagnostics() {
        let capture = CaptureDiagnostics::default();
        let dispatch = tracing::Dispatch::new(capture.clone());
        for (status, body, message, context_overflow) in [
            (
                StatusCode::OK,
                r#"{"error":{"message":"upstream returned no content","extra":"PRIVATE-ERROR-FIELD"},"request":"PRIVATE-ENVELOPE-CONTENT"}"#,
                "upstream returned no content",
                false,
            ),
            (
                StatusCode::CREATED,
                r#"{"detail":{"error":"model is unavailable"},"request":"PRIVATE-ENVELOPE-CONTENT"}"#,
                "model is unavailable",
                false,
            ),
            (
                StatusCode::ACCEPTED,
                r#"{"error":{"message":"maximum context length is 4096 tokens","extra":"PRIVATE-ERROR-FIELD"},"request":"PRIVATE-ENVELOPE-CONTENT"}"#,
                "maximum context length is 4096 tokens",
                true,
            ),
        ] {
            capture.events.lock().unwrap().clear();
            let error = tracing::dispatcher::with_default(&dispatch, || {
                parse_upstream_json_body(
                    "Custom OpenAI",
                    "generate",
                    status,
                    "application/json; charset=utf-8",
                    body.as_bytes(),
                )
            })
            .expect_err("a provider error must reject a successful HTTP response");

            let DomainError::InvalidData(reason) = &error else {
                panic!("provider error classification changed: {error}");
            };
            assert!(reason.contains(message));
            assert_eq!(
                reason.starts_with("model.context_overflow:"),
                context_overflow
            );

            let events = capture.events.lock().unwrap();
            assert_eq!(events.len(), 1, "provider failure needs HTTP diagnostics");
            let event = &events[0];
            assert_eq!(event.level, tracing::Level::WARN);
            assert_eq!(event.fields["provider"], "Custom OpenAI");
            assert_eq!(event.fields["operation"], "generate");
            assert_eq!(event.fields["status"], u64::from(status.as_u16()));
            assert_eq!(
                event.fields["content_type"],
                "application/json; charset=utf-8"
            );
            assert_eq!(event.fields["body_len"], body.len() as u64);
            assert!(event.fields["error"].as_str().unwrap().contains(message));
            let recorded = serde_json::to_string(&event.fields).unwrap();
            assert!(!recorded.contains("PRIVATE-ERROR-FIELD"));
            assert!(!recorded.contains("PRIVATE-ENVELOPE-CONTENT"));
        }

        for body in [
            r#"{"choices":[]}"#,
            r#"{"error":null,"choices":[]}"#,
            r#"{"error":false,"choices":[]}"#,
        ] {
            capture.events.lock().unwrap().clear();
            let value = tracing::dispatcher::with_default(&dispatch, || {
                parse_upstream_json_body(
                    "Custom OpenAI",
                    "generate",
                    StatusCode::OK,
                    "application/json",
                    body.as_bytes(),
                )
            })
            .expect("a JSON success must remain a success");
            assert!(value["choices"].is_array());
            assert!(capture.events.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn body_preview_string_truncates_to_first_512_bytes() {
        let body = vec![b'a'; BODY_PREVIEW_BYTES + 64];
        let preview = body_preview_string(&body);
        assert_eq!(preview.len(), BODY_PREVIEW_BYTES);
        assert!(preview.chars().all(|character| character == 'a'));
    }

    #[test]
    fn body_preview_string_replaces_invalid_utf8_lossily() {
        let body = vec![0xff, 0xfe, b'O', b'K'];
        let preview = body_preview_string(&body);
        assert!(preview.contains("OK"));
    }

    #[test]
    fn parse_upstream_json_body_returns_transient_invalid_response_for_non_json_body() {
        let error = parse_upstream_json_body(
            "OpenAI",
            "generate",
            StatusCode::OK,
            "text/html",
            b"<html>gateway challenge</html>",
        )
        .expect_err("non-json body should be transient");

        assert!(matches!(error, DomainError::Transient(_)));
        assert_eq!(
            error.to_string(),
            "model.upstream_invalid_response: OpenAI returned status 200 non-JSON body (generate): expected value at line 1 column 1"
        );
    }

    #[test]
    fn parse_upstream_json_body_accepts_valid_json_even_with_imprecise_content_type() {
        let value = parse_upstream_json_body(
            "OpenAI",
            "generate",
            StatusCode::OK,
            "text/plain",
            br#"{"ok":true}"#,
        )
        .expect("valid JSON should parse");

        assert_eq!(value["ok"], true);
    }
}

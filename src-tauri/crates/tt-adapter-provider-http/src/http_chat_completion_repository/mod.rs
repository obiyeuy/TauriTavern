use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue};
use reqwest::{Client, RequestBuilder, StatusCode, Url};
use serde_json::Value;

use tt_adapter_http::{HttpClientPool, HttpClientProfile};
use tt_domain::errors::DomainError;
use tt_domain::models::endpoint_url::append_endpoint_path;
use tt_domain::models::upstream_failure::UpstreamFailure;
use tt_ports::repositories::chat_completion_repository::{
    ChatCompletionApiConfig, ChatCompletionCancelReceiver, ChatCompletionRepository,
    ChatCompletionRepositoryGenerateResponse, ChatCompletionSource, ChatCompletionStreamDelta,
    ChatCompletionStreamSender,
};

mod aws_bedrock;
mod claude;
mod cohere;
mod context_overflow;
mod gemini;
mod gemini_interactions;
mod makersuite;
#[cfg(test)]
mod makersuite_tests;
mod normalizers;
mod openai;
mod openai_responses;
mod pollinations;
mod response_body;
#[cfg(test)]
mod test_support;
mod vertexai;
pub(crate) mod vertexai_auth;
mod workers_ai;
mod xai;

#[derive(Debug, Clone, Copy)]
struct PromptCachePerformanceUsage {
    cache_creation_input_tokens: u64,
    cache_read_input_tokens: u64,
    input_tokens: u64,
}

pub struct HttpChatCompletionRepository {
    http_clients: Arc<HttpClientPool>,
    openai_responses_ws_sessions: openai_responses::ResponsesWsSessionPool,
}

#[derive(Default)]
struct SseEventAccumulator {
    data: Vec<u8>,
    dispatched_payload: bool,
}

impl SseEventAccumulator {
    fn on_line<F: FnMut(&[u8]) -> Result<(), DomainError>>(
        &mut self,
        line: &[u8],
        on_event: &mut F,
    ) -> Result<(), DomainError> {
        if line.is_empty() {
            return self.dispatch(on_event);
        }

        if line.first().is_some_and(|byte| *byte == b':') {
            return Ok(());
        }

        let (field, value) = split_sse_field(line);
        if field == b"data" {
            if !self.data.is_empty() {
                self.data.push(b'\n');
            }
            self.data.extend_from_slice(value);
        }

        Ok(())
    }

    fn finish<F: FnMut(&[u8]) -> Result<(), DomainError>>(
        &mut self,
        on_event: &mut F,
    ) -> Result<(), DomainError> {
        self.dispatch(on_event)
    }

    fn dispatch<F: FnMut(&[u8]) -> Result<(), DomainError>>(
        &mut self,
        on_event: &mut F,
    ) -> Result<(), DomainError> {
        if self.data.is_empty() {
            return Ok(());
        }

        let payload = std::mem::take(&mut self.data);
        on_event(payload.as_slice())?;
        self.dispatched_payload = true;
        Ok(())
    }
}

fn split_sse_field(line: &[u8]) -> (&[u8], &[u8]) {
    let Some(colon_index) = line.iter().position(|byte| *byte == b':') else {
        return (line, b"");
    };

    let field = &line[..colon_index];
    let mut value = &line[colon_index + 1..];
    let value_start = value
        .iter()
        .position(|byte| *byte != b' ' && *byte != b'\t')
        .unwrap_or(value.len());
    value = &value[value_start..];

    (field, value)
}

impl HttpChatCompletionRepository {
    pub fn new(http_clients: Arc<HttpClientPool>) -> Self {
        Self {
            http_clients,
            openai_responses_ws_sessions: openai_responses::ResponsesWsSessionPool::default(),
        }
    }

    fn client(&self, config: &ChatCompletionApiConfig) -> Result<Client, DomainError> {
        self.client_for_profile(config, HttpClientProfile::ChatCompletion)
    }

    fn metadata_client(&self, config: &ChatCompletionApiConfig) -> Result<Client, DomainError> {
        self.client_for_profile(config, HttpClientProfile::ProviderMetadata)
    }

    fn client_for_profile(
        &self,
        config: &ChatCompletionApiConfig,
        profile: HttpClientProfile,
    ) -> Result<Client, DomainError> {
        if config.user_configured_endpoint {
            self.http_clients
                .user_endpoint_client(profile, &config.base_url)
        } else {
            self.http_clients.client(profile)
        }
    }

    fn stream_client(&self, config: &ChatCompletionApiConfig) -> Result<Client, DomainError> {
        self.client_for_profile(config, HttpClientProfile::ChatCompletionStream)
    }

    fn websocket_client(
        &self,
        config: &ChatCompletionApiConfig,
    ) -> Result<(Client, u64), DomainError> {
        if config.user_configured_endpoint {
            self.http_clients.user_endpoint_client_with_revision(
                HttpClientProfile::ChatCompletionWebSocket,
                &config.base_url,
            )
        } else {
            self.http_clients
                .client_with_revision(HttpClientProfile::ChatCompletionWebSocket)
        }
    }

    fn build_url(base_url: &str, path: &str) -> Result<Url, DomainError> {
        append_endpoint_path(base_url, path)
    }

    fn apply_bearer_auth(request: RequestBuilder, api_key: &str) -> RequestBuilder {
        if api_key.trim().is_empty() {
            request
        } else {
            request.header(AUTHORIZATION, format!("Bearer {api_key}"))
        }
    }

    fn apply_openai_auth(
        request: RequestBuilder,
        config: &ChatCompletionApiConfig,
    ) -> RequestBuilder {
        if let Some(authorization_header) = config.authorization_header.as_deref() {
            Self::apply_header_if_present(request, "Authorization", authorization_header)
        } else {
            Self::apply_bearer_auth(request, &config.api_key)
        }
    }

    fn apply_header_if_present(
        request: RequestBuilder,
        header_name: &str,
        header_value: &str,
    ) -> RequestBuilder {
        if header_value.trim().is_empty() {
            request
        } else {
            request.header(header_name, header_value)
        }
    }

    fn apply_extra_headers(
        request: RequestBuilder,
        headers: &HashMap<String, String>,
    ) -> RequestBuilder {
        Self::apply_extra_headers_with_filter(request, headers, |_, _| false)
    }

    fn apply_additional_headers(
        request: RequestBuilder,
        config: &ChatCompletionApiConfig,
    ) -> RequestBuilder {
        Self::apply_extra_headers(request, &config.additional_headers)
    }

    fn apply_extra_headers_with_filter<F>(
        request: RequestBuilder,
        headers: &HashMap<String, String>,
        mut should_skip: F,
    ) -> RequestBuilder
    where
        F: FnMut(&str, &str) -> bool,
    {
        let mut header_map = HeaderMap::new();

        for (key, value) in headers {
            if should_skip(key, value) {
                continue;
            }

            let key = key.trim();
            let value = value.trim();
            if key.is_empty() || value.is_empty() {
                continue;
            }

            let header_name = match HeaderName::from_bytes(key.as_bytes()) {
                Ok(header_name) => header_name,
                Err(_) => return request.header(key, value),
            };
            let header_value = match HeaderValue::from_str(value) {
                Ok(header_value) => header_value,
                Err(_) => return request.header(header_name, value),
            };

            header_map.insert(header_name, header_value);
        }

        if header_map.is_empty() {
            request
        } else {
            request.headers(header_map)
        }
    }

    async fn send_checked(
        request: RequestBuilder,
        provider_name: &str,
        error_context: &str,
    ) -> Result<reqwest::Response, DomainError> {
        let response = request
            .send()
            .await
            .map_err(|error| Self::map_transport_error(error_context, error))?;

        if !response.status().is_success() {
            return Err(Self::map_error_response(provider_name, response, error_context).await);
        }

        Ok(response)
    }

    async fn map_error_response(
        provider_name: &str,
        response: reqwest::Response,
        default_message: &str,
    ) -> DomainError {
        let status = response.status();
        let endpoint = crate::http_error::sanitize_endpoint(response.url());
        let body = response.text().await.unwrap_or_default();
        Self::map_error_status(
            provider_name,
            status,
            &body,
            default_message,
            Some(endpoint),
        )
    }

    fn map_error_status(
        provider_name: &str,
        status: StatusCode,
        body: &str,
        default_message: &str,
        endpoint: Option<String>,
    ) -> DomainError {
        let body = body.trim();
        let parsed = serde_json::from_str::<Value>(body).ok();
        let error = parsed.as_ref().and_then(response_body::provider_error);
        let message = parsed
            .as_ref()
            .and_then(|value| match error {
                Some(error) => Some(response_body::provider_error_message(error, value)),
                None => value
                    .get("message")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            })
            .unwrap_or_else(|| {
                if body.is_empty() {
                    default_message
                } else {
                    body
                }
                .to_string()
            });

        let status_error = |message: String| match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                DomainError::AuthenticationError(message)
            }
            StatusCode::BAD_REQUEST => DomainError::InvalidData(message),
            StatusCode::TOO_MANY_REQUESTS => DomainError::rate_limited(format!(
                "{provider_name} endpoint failed with status {}: {message}",
                status.as_u16()
            )),
            status if is_retryable_status(status) => DomainError::transient(format!(
                "{provider_name} endpoint failed with status {}: {message}",
                status.as_u16()
            )),
            _ => DomainError::InternalError(format!(
                "{provider_name} endpoint failed with status {}: {message}",
                status.as_u16()
            )),
        };

        match status {
            StatusCode::NOT_FOUND => {
                DomainError::upstream_failure(UpstreamFailure::http_not_found(endpoint, message))
            }
            StatusCode::PAYLOAD_TOO_LARGE => context_overflow::context_overflow_error(message),
            StatusCode::BAD_REQUEST => {
                let error = error.map_or_else(|| body.to_owned(), Value::to_string);
                context_overflow::context_overflow_or(error, message, status_error)
            }
            _ => status_error(message),
        }
    }

    fn map_transport_error(label: &str, error: reqwest::Error) -> DomainError {
        let failure = crate::http_error::reqwest_transport_failure(&error);
        tracing::warn!(
            operation = label,
            code = %failure.code,
            category = %failure.category,
            endpoint = failure.endpoint.as_deref().unwrap_or(""),
            timeout = error.is_timeout(),
            connect = error.is_connect(),
            body = error.is_body(),
            request = error.is_request(),
            "upstream transport request failed",
        );
        DomainError::upstream_failure(failure)
    }

    async fn stream_sse_response(
        provider_name: &str,
        response: reqwest::Response,
        sender: ChatCompletionStreamSender,
        cancel: ChatCompletionCancelReceiver,
    ) -> Result<(), DomainError> {
        Self::stream_sse_response_with_hook(provider_name, response, sender, cancel, |_| Ok(()))
            .await
    }

    async fn stream_sse_response_with_hook<F>(
        provider_name: &str,
        response: reqwest::Response,
        sender: ChatCompletionStreamSender,
        mut cancel: ChatCompletionCancelReceiver,
        mut hook: F,
    ) -> Result<(), DomainError>
    where
        F: FnMut(&[u8]) -> Result<(), DomainError>,
    {
        let consume = Self::consume_sse_response(provider_name, response, |payload| {
            hook(payload)?;
            let payload = std::str::from_utf8(payload).map_err(|error| {
                DomainError::InternalError(format!("SSE payload is not valid UTF-8: {error}"))
            })?;
            let _ = sender.send(payload.to_string());
            Ok(())
        });
        tokio::pin!(consume);

        tokio::select! {
            // Cancellation may already be ready when the HTTP response arrives.
            biased;
            Ok(_) = cancel.wait_for(|cancelled| *cancelled) => Ok(()),
            result = &mut consume => result,
        }
    }

    async fn stream_sse_response_with_cache_logging(
        provider_name: &str,
        model: String,
        response: reqwest::Response,
        sender: ChatCompletionStreamSender,
        cancel: ChatCompletionCancelReceiver,
    ) -> Result<(), DomainError> {
        let mut logged = false;
        Self::stream_sse_response_with_hook(
            provider_name,
            response,
            sender,
            cancel,
            move |payload| {
                if logged {
                    return Ok(());
                }

                let has_cache_usage = [
                    b"cache_read_input_tokens".as_slice(),
                    b"cache_creation_input_tokens".as_slice(),
                ]
                .into_iter()
                .any(|field| payload.windows(field.len()).any(|window| window == field));
                if !has_cache_usage {
                    return Ok(());
                }

                let Ok(value) = serde_json::from_slice::<Value>(payload) else {
                    return Ok(());
                };
                logged = log_prompt_cache_performance_if_present(
                    provider_name,
                    Some(model.as_str()),
                    &value,
                );
                Ok(())
            },
        )
        .await
    }

    async fn consume_sse_response<F>(
        provider_name: &str,
        mut response: reqwest::Response,
        mut on_event: F,
    ) -> Result<(), DomainError>
    where
        F: FnMut(&[u8]) -> Result<(), DomainError>,
    {
        let mut buffer = Vec::<u8>::new();
        let mut accumulator = SseEventAccumulator::default();
        let endpoint = response.url().clone();
        let status = response.status();
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let mut body_len = 0_usize;

        loop {
            let chunk = response.chunk().await.map_err(|error| {
                let failure = crate::http_error::reqwest_body_failure(&error, Some(&endpoint));
                tracing::warn!(
                    provider = provider_name,
                    operation = "stream",
                    status = status.as_u16(),
                    content_type = content_type,
                    body_len,
                    code = %failure.code,
                    category = %failure.category,
                    endpoint = failure.endpoint.as_deref().unwrap_or(""),
                    timeout = error.is_timeout(),
                    connect = error.is_connect(),
                    body = error.is_body(),
                    request = error.is_request(),
                    "upstream stream read failed",
                );
                DomainError::upstream_failure(failure)
            })?;

            let Some(chunk) = chunk else {
                break;
            };

            body_len += chunk.len();
            buffer.extend_from_slice(&chunk);
            Self::forward_sse_events(&mut buffer, &mut accumulator, &mut on_event)?;
        }

        if !buffer.is_empty() {
            Self::forward_sse_events(&mut buffer, &mut accumulator, &mut on_event)?;
            Self::forward_sse_line(buffer.as_slice(), &mut accumulator, &mut on_event)?;
            buffer.clear();
        }

        accumulator.finish(&mut on_event)?;
        if !accumulator.dispatched_payload {
            let failure = DomainError::transient(format!(
                "model.upstream_invalid_response: {provider_name} returned status {} without SSE data (stream)",
                status.as_u16()
            ));
            tracing::warn!(
                provider = provider_name,
                operation = "stream",
                status = status.as_u16(),
                content_type = content_type,
                body_len,
                endpoint = %crate::http_error::sanitize_endpoint(&endpoint),
                error = %failure,
                "upstream stream ended without a data payload",
            );
            return Err(failure);
        }
        Ok(())
    }

    fn forward_sse_events<F: FnMut(&[u8]) -> Result<(), DomainError>>(
        buffer: &mut Vec<u8>,
        accumulator: &mut SseEventAccumulator,
        on_event: &mut F,
    ) -> Result<(), DomainError> {
        let mut line_start = 0_usize;
        let mut consumed = 0_usize;

        for (index, byte) in buffer.iter().enumerate() {
            if *byte != b'\n' {
                continue;
            }

            let mut line = &buffer[line_start..index];
            if line.last().is_some_and(|byte| *byte == b'\r') {
                line = &line[..line.len() - 1];
            }

            accumulator.on_line(line, on_event)?;
            consumed = index + 1;
            line_start = consumed;
        }

        if consumed > 0 {
            buffer.drain(..consumed);
        }

        Ok(())
    }

    fn forward_sse_line<F: FnMut(&[u8]) -> Result<(), DomainError>>(
        line: &[u8],
        accumulator: &mut SseEventAccumulator,
        on_event: &mut F,
    ) -> Result<(), DomainError> {
        let mut line = line;
        if line.last().is_some_and(|byte| *byte == b'\r') {
            line = &line[..line.len() - 1];
        }

        accumulator.on_line(line, on_event)
    }
}

fn payload_contains_cache_control(value: &Value) -> bool {
    match value {
        Value::Object(object) => {
            object.contains_key("cache_control")
                || object.values().any(payload_contains_cache_control)
        }
        Value::Array(array) => array.iter().any(payload_contains_cache_control),
        _ => false,
    }
}

fn is_retryable_status(status: StatusCode) -> bool {
    matches!(status.as_u16(), 408 | 425 | 429 | 500 | 502 | 503 | 504)
}

fn current_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn log_prompt_cache_performance_if_present(
    provider_name: &str,
    model: Option<&str>,
    value: &Value,
) -> bool {
    let Some(usage) = find_prompt_cache_performance_usage(value) else {
        return false;
    };

    let total_input_tokens =
        usage.cache_creation_input_tokens + usage.cache_read_input_tokens + usage.input_tokens;

    match model.map(str::trim).filter(|value| !value.is_empty()) {
        Some(model) => {
            tracing::info!(
                "{provider_name} prompt cache usage: model={model} cache_read_input_tokens={} cache_creation_input_tokens={} input_tokens={} total_input_tokens={}",
                usage.cache_read_input_tokens,
                usage.cache_creation_input_tokens,
                usage.input_tokens,
                total_input_tokens,
            );
        }
        None => {
            tracing::info!(
                "{provider_name} prompt cache usage: cache_read_input_tokens={} cache_creation_input_tokens={} input_tokens={} total_input_tokens={}",
                usage.cache_read_input_tokens,
                usage.cache_creation_input_tokens,
                usage.input_tokens,
                total_input_tokens,
            );
        }
    }

    true
}

fn find_prompt_cache_performance_usage(value: &Value) -> Option<PromptCachePerformanceUsage> {
    if let Some(usage) = value.get("usage").and_then(Value::as_object)
        && let Some(parsed) = parse_prompt_cache_performance_usage(usage)
    {
        return Some(parsed);
    }

    if let Some(message_usage) = value
        .get("message")
        .and_then(Value::as_object)
        .and_then(|message| message.get("usage"))
        .and_then(Value::as_object)
        && let Some(parsed) = parse_prompt_cache_performance_usage(message_usage)
    {
        return Some(parsed);
    }

    None
}

fn parse_prompt_cache_performance_usage(
    usage: &serde_json::Map<String, Value>,
) -> Option<PromptCachePerformanceUsage> {
    let cache_creation_input_tokens = value_to_u64(usage.get("cache_creation_input_tokens"))?;
    let cache_read_input_tokens = value_to_u64(usage.get("cache_read_input_tokens"))?;
    let input_tokens = value_to_u64(usage.get("input_tokens"))?;

    Some(PromptCachePerformanceUsage {
        cache_creation_input_tokens,
        cache_read_input_tokens,
        input_tokens,
    })
}

fn value_to_u64(value: Option<&Value>) -> Option<u64> {
    value.and_then(Value::as_u64)
}

fn provider_transport_source(
    source: ChatCompletionSource,
    endpoint_path: &str,
) -> Result<ChatCompletionSource, DomainError> {
    if source == ChatCompletionSource::Custom
        && matches!(endpoint_path, "/generateContent" | "/streamGenerateContent")
    {
        return Ok(ChatCompletionSource::Makersuite);
    }

    if source != ChatCompletionSource::OpenCode {
        return Ok(source);
    }

    match endpoint_path {
        "/chat/completions" | "/responses" => Ok(ChatCompletionSource::OpenAi),
        "/messages" => Ok(ChatCompletionSource::Claude),
        "/generateContent" | "/streamGenerateContent" => Ok(ChatCompletionSource::Makersuite),
        path => Err(DomainError::InvalidData(format!(
            "Unsupported OpenCode endpoint path: {path}"
        ))),
    }
}

#[async_trait]
impl ChatCompletionRepository for HttpChatCompletionRepository {
    async fn list_models(
        &self,
        source: ChatCompletionSource,
        config: &ChatCompletionApiConfig,
    ) -> Result<Value, DomainError> {
        let source_name = source.display_name();

        match source {
            ChatCompletionSource::OpenAi
            | ChatCompletionSource::OpenCode
            | ChatCompletionSource::OpenRouter
            | ChatCompletionSource::Custom
            | ChatCompletionSource::DeepSeek
            | ChatCompletionSource::Groq
            | ChatCompletionSource::Moonshot
            | ChatCompletionSource::Chutes
            | ChatCompletionSource::Zai => openai::list_models(self, config, source_name).await,
            ChatCompletionSource::SiliconFlow => {
                openai::list_models_with_path(
                    self,
                    config,
                    source_name,
                    "/models?type=text&sub_type=chat",
                )
                .await
            }
            ChatCompletionSource::WorkersAi => workers_ai::list_models(self, config).await,
            ChatCompletionSource::Pollinations => pollinations::list_models(self, config).await,
            ChatCompletionSource::Xai => xai::list_models(self, config).await,
            ChatCompletionSource::Cohere => cohere::list_models(self, config).await,
            ChatCompletionSource::NanoGpt => {
                openai::list_models_with_path(self, config, source_name, "/models?detailed=true")
                    .await
            }
            ChatCompletionSource::MiniMax => Err(DomainError::InvalidData(
                "MiniMax does not expose dynamic model listing; status bypass belongs to the application service".to_string(),
            )),
            ChatCompletionSource::AwsBedrock => aws_bedrock::list_models(self, config).await,
            ChatCompletionSource::Claude => claude::list_models(self, config).await,
            ChatCompletionSource::Makersuite => makersuite::list_models(self, config).await,
            ChatCompletionSource::VertexAi => vertexai::list_models(self, config).await,
        }
    }

    async fn generate(
        &self,
        source: ChatCompletionSource,
        config: &ChatCompletionApiConfig,
        endpoint_path: &str,
        payload: &Value,
    ) -> Result<ChatCompletionRepositoryGenerateResponse, DomainError> {
        let source_name = source.display_name();
        let source = provider_transport_source(source, endpoint_path)?;

        match (source, endpoint_path) {
            (ChatCompletionSource::OpenAi, "/responses") => {
                openai_responses::generate(self, config, endpoint_path, payload, "OpenAI Responses")
                    .await
            }
            (ChatCompletionSource::Custom, "/responses") => {
                openai_responses::generate(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    "Custom OpenAI Responses",
                )
                .await
            }
            (ChatCompletionSource::Custom, "/interactions") => {
                gemini_interactions::generate(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    "Custom Gemini Interactions",
                )
                .await
            }
            (ChatCompletionSource::Custom, "/messages") => {
                claude::generate(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    "Custom Claude Messages",
                )
                .await
            }
            (
                ChatCompletionSource::OpenAi
                | ChatCompletionSource::OpenRouter
                | ChatCompletionSource::Custom
                | ChatCompletionSource::DeepSeek
                | ChatCompletionSource::Groq
                | ChatCompletionSource::Moonshot
                | ChatCompletionSource::NanoGpt
                | ChatCompletionSource::Chutes
                | ChatCompletionSource::SiliconFlow
                | ChatCompletionSource::WorkersAi
                | ChatCompletionSource::Zai
                | ChatCompletionSource::MiniMax
                | ChatCompletionSource::Xai
                | ChatCompletionSource::Pollinations,
                _,
            ) => openai::generate(self, config, endpoint_path, payload, source_name)
                .await
                .map(ChatCompletionRepositoryGenerateResponse::from_body),
            (ChatCompletionSource::Cohere, _) => {
                cohere::generate(self, config, endpoint_path, payload)
                    .await
                    .map(ChatCompletionRepositoryGenerateResponse::from_body)
            }
            (ChatCompletionSource::Claude, _) => {
                claude::generate(self, config, endpoint_path, payload, source_name).await
            }
            (ChatCompletionSource::AwsBedrock, _) => {
                aws_bedrock::generate(self, config, endpoint_path, payload).await
            }
            (ChatCompletionSource::Makersuite, _) => {
                makersuite::generate(self, config, endpoint_path, payload).await
            }
            (ChatCompletionSource::VertexAi, _) => {
                vertexai::generate(self, config, endpoint_path, payload).await
            }
            (ChatCompletionSource::OpenCode, _) => {
                unreachable!("OpenCode source is resolved to its wire transport before dispatch")
            }
        }
    }

    async fn generate_stream(
        &self,
        source: ChatCompletionSource,
        config: &ChatCompletionApiConfig,
        endpoint_path: &str,
        payload: &Value,
        sender: ChatCompletionStreamSender,
        cancel: ChatCompletionCancelReceiver,
    ) -> Result<(), DomainError> {
        let source_name = source.display_name();
        let source = provider_transport_source(source, endpoint_path)?;

        match (source, endpoint_path) {
            (ChatCompletionSource::OpenAi, "/responses") => {
                openai_responses::generate_stream(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    "OpenAI Responses",
                    sender,
                    cancel,
                )
                .await
            }
            (ChatCompletionSource::Custom, "/responses") => {
                openai_responses::generate_stream(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    "Custom OpenAI Responses",
                    sender,
                    cancel,
                )
                .await
            }
            (ChatCompletionSource::Custom, "/interactions") => {
                gemini_interactions::generate_stream(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    "Custom Gemini Interactions",
                    sender,
                    cancel,
                )
                .await
            }
            (ChatCompletionSource::Custom, "/messages") => {
                claude::generate_stream(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    "Custom Claude Messages",
                    sender,
                    cancel,
                )
                .await
            }
            (
                ChatCompletionSource::OpenAi
                | ChatCompletionSource::OpenRouter
                | ChatCompletionSource::Custom
                | ChatCompletionSource::DeepSeek
                | ChatCompletionSource::Groq
                | ChatCompletionSource::Moonshot
                | ChatCompletionSource::NanoGpt
                | ChatCompletionSource::Chutes
                | ChatCompletionSource::SiliconFlow
                | ChatCompletionSource::WorkersAi
                | ChatCompletionSource::Zai
                | ChatCompletionSource::MiniMax
                | ChatCompletionSource::Xai
                | ChatCompletionSource::Pollinations,
                _,
            ) => {
                openai::generate_stream(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    source_name,
                    sender,
                    cancel,
                )
                .await
            }
            (ChatCompletionSource::Cohere, _) => {
                cohere::generate_stream(self, config, endpoint_path, payload, sender, cancel).await
            }
            (ChatCompletionSource::Claude, _) => {
                claude::generate_stream(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    source_name,
                    sender,
                    cancel,
                )
                .await
            }
            (ChatCompletionSource::AwsBedrock, _) => {
                aws_bedrock::generate_stream(self, config, endpoint_path, payload, sender, cancel)
                    .await
            }
            (ChatCompletionSource::Makersuite, _) => {
                makersuite::generate_stream(self, config, endpoint_path, payload, sender, cancel)
                    .await
            }
            (ChatCompletionSource::VertexAi, _) => {
                vertexai::generate_stream(self, config, endpoint_path, payload, sender, cancel)
                    .await
            }
            (ChatCompletionSource::OpenCode, _) => {
                unreachable!("OpenCode source is resolved to its wire transport before dispatch")
            }
        }
    }

    async fn generate_with_deltas(
        &self,
        source: ChatCompletionSource,
        config: &ChatCompletionApiConfig,
        endpoint_path: &str,
        payload: &Value,
        on_delta: &mut (dyn FnMut(ChatCompletionStreamDelta) + Send),
    ) -> Result<ChatCompletionRepositoryGenerateResponse, DomainError> {
        let source_name = source.display_name();
        let source = provider_transport_source(source, endpoint_path)?;

        match (source, endpoint_path) {
            (ChatCompletionSource::OpenAi, "/responses") => {
                openai_responses::generate_with_deltas(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    "OpenAI Responses",
                    on_delta,
                )
                .await
            }
            (ChatCompletionSource::Custom, "/responses") => {
                openai_responses::generate_with_deltas(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    "Custom OpenAI Responses",
                    on_delta,
                )
                .await
            }
            (ChatCompletionSource::Custom, "/interactions") => {
                gemini_interactions::generate_with_deltas(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    "Custom Gemini Interactions",
                    on_delta,
                )
                .await
            }
            (ChatCompletionSource::Custom, "/messages") => {
                claude::generate_with_deltas(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    "Custom Claude Messages",
                    on_delta,
                )
                .await
            }
            (ChatCompletionSource::Claude, _) => {
                claude::generate_with_deltas(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    source_name,
                    on_delta,
                )
                .await
            }
            (ChatCompletionSource::Makersuite, _) => {
                makersuite::generate_with_deltas(self, config, endpoint_path, payload, on_delta)
                    .await
            }
            (ChatCompletionSource::VertexAi, _) => {
                vertexai::generate_with_deltas(self, config, endpoint_path, payload, on_delta).await
            }
            (ChatCompletionSource::AwsBedrock, _) => {
                aws_bedrock::generate_with_deltas(self, config, endpoint_path, payload, on_delta)
                    .await
            }
            (
                ChatCompletionSource::OpenAi
                | ChatCompletionSource::OpenRouter
                | ChatCompletionSource::Custom
                | ChatCompletionSource::DeepSeek
                | ChatCompletionSource::Groq
                | ChatCompletionSource::Moonshot
                | ChatCompletionSource::NanoGpt
                | ChatCompletionSource::Chutes
                | ChatCompletionSource::SiliconFlow
                | ChatCompletionSource::WorkersAi
                | ChatCompletionSource::Zai
                | ChatCompletionSource::MiniMax
                | ChatCompletionSource::Xai
                | ChatCompletionSource::Pollinations,
                "/chat/completions",
            ) => {
                openai::generate_with_deltas(
                    self,
                    config,
                    endpoint_path,
                    payload,
                    source_name,
                    on_delta,
                )
                .await
            }
            (source, endpoint_path) => Err(DomainError::InvalidData(format!(
                "Tool-call delta streaming is unsupported for source `{}` endpoint `{endpoint_path}`",
                source.key()
            ))),
        }
    }

    async fn close_provider_session(&self, session_id: &str) {
        self.openai_responses_ws_sessions.close(session_id).await;
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use reqwest::Client;
    use reqwest::header::AUTHORIZATION;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::sync::{mpsc, oneshot, watch};
    use tracing::instrument::WithSubscriber;

    use tt_adapter_http::HttpClientPool;
    use tt_domain::errors::DomainError;
    use tt_ports::repositories::chat_completion_repository::{
        ChatCompletionApiConfig, ChatCompletionRepository, ChatCompletionSource,
    };
    use tt_ports::user_endpoint_access::UserEndpointGrantRuntime;

    use super::test_support::CaptureDiagnostics;
    use super::{HttpChatCompletionRepository, provider_transport_source};

    async fn read_http_request(socket: &mut BufReader<TcpStream>) {
        let mut content_length = 0;
        loop {
            let mut line = String::new();
            assert_ne!(socket.read_line(&mut line).await.unwrap(), 0);
            if line == "\r\n" {
                break;
            }
            if let Some((name, value)) = line.split_once(':')
                && name.eq_ignore_ascii_case("content-length")
            {
                content_length = value.trim().parse().unwrap();
            }
        }
        socket
            .read_exact(&mut vec![0; content_length])
            .await
            .unwrap();
    }

    async fn start_stream_response(
        content_type: &str,
        chunks: Vec<Vec<u8>>,
        finish: Option<oneshot::Receiver<bool>>,
        reported_length: Option<usize>,
    ) -> (String, oneshot::Receiver<()>, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
        let (header_sent, header_ready) = oneshot::channel();
        let framing = reported_length.map_or_else(
            || "Transfer-Encoding: chunked".to_owned(),
            |length| format!("Content-Length: {length}"),
        );
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\n{framing}\r\nConnection: close\r\n\r\n"
        );
        let server = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut socket = BufReader::new(socket);
            read_http_request(&mut socket).await;
            let socket = socket.get_mut();
            socket.write_all(headers.as_bytes()).await.unwrap();
            let _ = header_sent.send(());
            for chunk in chunks {
                if reported_length.is_none() {
                    socket
                        .write_all(format!("{:x}\r\n", chunk.len()).as_bytes())
                        .await
                        .unwrap();
                }
                socket.write_all(&chunk).await.unwrap();
                if reported_length.is_none() {
                    socket.write_all(b"\r\n").await.unwrap();
                }
            }
            let complete = match finish {
                Some(finish) => finish.await.unwrap(),
                None => true,
            };
            if reported_length.is_none() && complete {
                socket.write_all(b"0\r\n\r\n").await.unwrap();
            }
        });
        (base_url, header_ready, server)
    }

    fn stream_test_config(base_url: String) -> ChatCompletionApiConfig {
        ChatCompletionApiConfig {
            base_url,
            user_configured_endpoint: true,
            api_key: String::new(),
            authorization_header: None,
            vertexai_service_account_json: None,
            extra_headers: HashMap::new(),
            additional_headers: HashMap::new(),
            anthropic_beta_header_mode:
                tt_ports::repositories::chat_completion_repository::AnthropicBetaHeaderMode::None,
            aws_bedrock_custom_response_path: None,
            aws_bedrock_custom_stream_path: None,
        }
    }

    fn stream_test_repository(base_url: &str) -> HttpChatCompletionRepository {
        let pool = Arc::new(HttpClientPool::new("sse-test"));
        let grant = tt_domain::models::endpoint_url::parse_user_http_endpoint(base_url)
            .unwrap()
            .to_string();
        pool.replace_user_endpoint_grants(&[grant]);
        HttpChatCompletionRepository::new(pool)
    }

    #[tokio::test]
    async fn sse_generation_rejects_responses_without_payload() {
        let mut accepted_without_payload = Vec::new();
        for (content_type, body) in [
            (
                "application/json",
                r#"{"error":{"message":"no output","extra":"PRIVATE-STREAM-BODY"}}"#,
            ),
            (
                "application/json",
                "{\n\"error\": {\"message\": \"no output\"}\n}",
            ),
            ("text/event-stream", ""),
            ("text/html", "<html>PRIVATE-STREAM-BODY</html>"),
            (
                "text/event-stream",
                ": keepalive\n\nevent: message\nid: 7\n\n",
            ),
        ] {
            let chunks = if body.is_empty() {
                vec![]
            } else {
                vec![body.as_bytes().to_vec()]
            };
            let (base_url, _header, server) =
                start_stream_response(content_type, chunks, None, None).await;
            let expected_endpoint = format!("{base_url}/chat/completions");
            let repository = stream_test_repository(&base_url);
            let (sender, mut receiver) = mpsc::unbounded_channel();
            let (_cancel, cancel) = watch::channel(false);
            let capture = CaptureDiagnostics::default();
            let result = repository
                .generate_stream(
                    ChatCompletionSource::Custom,
                    &stream_test_config(base_url),
                    "/chat/completions?secret=PRIVATE-QUERY",
                    &serde_json::json!({"model":"probe","stream":true}),
                    sender,
                    cancel,
                )
                .with_subscriber(tracing::Dispatch::new(capture.clone()))
                .await;
            assert!(
                receiver.recv().await.is_none(),
                "an invalid stream must not produce payload"
            );
            let error = match result {
                Err(error) => error,
                Ok(()) => {
                    server.await.unwrap();
                    accepted_without_payload.push((content_type, body.len()));
                    continue;
                }
            };
            assert!(
                matches!(&error, DomainError::Transient(reason) if reason.starts_with("model.upstream_invalid_response:"))
            );
            server.await.unwrap();
            let events = capture.events.lock().unwrap();
            assert_eq!(events.len(), 1);
            assert_eq!(events[0].level, tracing::Level::WARN);
            let fields = &events[0].fields;
            assert_eq!(fields["provider"], "Custom OpenAI");
            assert_eq!(fields["operation"], "stream");
            assert_eq!(fields["status"], 200);
            assert_eq!(fields["content_type"], content_type);
            assert_eq!(fields["body_len"], body.len() as u64);
            assert_eq!(fields["endpoint"], expected_endpoint);
            let recorded = serde_json::to_string(fields).unwrap();
            assert!(!recorded.contains("PRIVATE-STREAM-BODY"));
            assert!(!recorded.contains("PRIVATE-QUERY"));
        }
        assert!(
            accepted_without_payload.is_empty(),
            "responses without SSE payload were reported successful: {accepted_without_payload:?}"
        );
    }

    #[tokio::test]
    async fn sse_generation_streams_before_eof_and_preserves_tail() {
        let body = "{\"unknown\":\"field\"}\n: keepalive\r\nevent: message\r\ndata: first你\r\ndata: second\r\n\r\ndata: tail";
        let chunks = body.as_bytes().chunks(2).map(<[u8]>::to_vec).collect();
        let (finish, gate) = oneshot::channel();
        let (base_url, _header, server) =
            start_stream_response("application/json", chunks, Some(gate), None).await;
        let repository = stream_test_repository(&base_url);
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let (_cancel, cancel) = watch::channel(false);
        let generation = tokio::spawn(async move {
            repository
                .generate_stream(
                    ChatCompletionSource::Custom,
                    &stream_test_config(base_url),
                    "/chat/completions",
                    &serde_json::json!({"model":"probe","stream":true}),
                    sender,
                    cancel,
                )
                .await
        });
        let first = receiver.recv().await;
        if first.is_none() {
            panic!(
                "generation ended before its first payload: {:?}",
                generation.await.unwrap()
            );
        }
        assert_eq!(first.as_deref(), Some("first你\nsecond"));
        finish.send(true).unwrap();
        assert_eq!(receiver.recv().await.as_deref(), Some("tail"));
        assert!(generation.await.unwrap().is_ok());
        assert!(receiver.recv().await.is_none());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn sse_generation_cancellation_and_body_failures_keep_their_meaning() {
        for endpoint_path in ["/chat/completions", "/responses", "/interactions"] {
            let (base_url, _header, server) =
                start_stream_response("text/event-stream", vec![], None, Some(0)).await;
            let repository = stream_test_repository(&base_url);
            let (sender, mut receiver) = mpsc::unbounded_channel();
            let (cancel, signal) = watch::channel(false);
            let capture = CaptureDiagnostics::default();
            // Cancellation predates the HTTP headers; Content-Length: 0 makes
            // EOF ready as soon as the response reaches the shared reader.
            cancel.send(true).unwrap();
            let result = repository
                .generate_stream(
                    ChatCompletionSource::Custom,
                    &stream_test_config(base_url),
                    endpoint_path,
                    &serde_json::json!({"model":"probe","stream":true}),
                    sender,
                    signal,
                )
                .with_subscriber(tracing::Dispatch::new(capture.clone()))
                .await;
            assert!(
                result.is_ok(),
                "an already cancelled {endpoint_path} must not fail at empty EOF: {result:?}"
            );
            assert!(receiver.recv().await.is_none());
            assert!(capture.events.lock().unwrap().is_empty());
            server.await.unwrap();
        }

        let (finish, gate) = oneshot::channel();
        let (base_url, header, server) =
            start_stream_response("text/event-stream", vec![], Some(gate), None).await;
        let repository = stream_test_repository(&base_url);
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let (cancel, signal) = watch::channel(false);
        let capture = CaptureDiagnostics::default();
        let mut generation = tokio::spawn({
            let capture = capture.clone();
            async move {
                repository
                    .generate_stream(
                        ChatCompletionSource::Custom,
                        &stream_test_config(base_url),
                        "/chat/completions",
                        &serde_json::json!({"model":"probe","stream":true}),
                        sender,
                        signal,
                    )
                    .with_subscriber(tracing::Dispatch::new(capture))
                    .await
            }
        });
        tokio::select! {
            result = &mut generation => {
                panic!("generation ended before HTTP headers: {:?}", result.unwrap());
            }
            ready = header => ready.unwrap(),
        }
        cancel.send(true).unwrap();
        assert!(generation.await.unwrap().is_ok());
        assert!(receiver.recv().await.is_none());
        assert!(capture.events.lock().unwrap().is_empty());
        finish.send(false).unwrap();
        server.await.unwrap();

        let body = b"data: partial\n\n";
        let (base_url, _header, server) = start_stream_response(
            "text/event-stream",
            vec![body.to_vec()],
            None,
            Some(body.len() + 8),
        )
        .await;
        let repository = stream_test_repository(&base_url);
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let (_cancel, signal) = watch::channel(false);
        let capture = CaptureDiagnostics::default();
        let result = repository
            .generate_stream(
                ChatCompletionSource::Custom,
                &stream_test_config(base_url),
                "/chat/completions",
                &serde_json::json!({"model":"probe","stream":true}),
                sender,
                signal,
            )
            .with_subscriber(tracing::Dispatch::new(capture.clone()))
            .await;
        let DomainError::UpstreamFailure(failure) = result.unwrap_err() else {
            panic!("a truncated HTTP body must preserve the network failure");
        };
        assert_eq!(failure.code, "network.body_interrupted");
        server.await.unwrap();
        assert_eq!(receiver.recv().await.as_deref(), Some("partial"));
        let events = capture.events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].fields["status"], 200);
        assert_eq!(events[0].fields["code"], "network.body_interrupted");
    }

    #[tokio::test]
    async fn upstream_404_preserves_the_failed_endpoint_and_service_message() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/v1/responses", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut socket = BufReader::new(socket);
            read_http_request(&mut socket).await;
            let body = r#"{"error":{"message":"This API does not provide /responses"}}"#;
            socket
                .get_mut()
                .write_all(
                    format!(
                        "HTTP/1.1 404 Not Found\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        let request = Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .post(format!("{endpoint}?key=TEST-ONLY"));
        let error = HttpChatCompletionRepository::send_checked(
            request,
            "Custom OpenAI Responses",
            "Generation request failed",
        )
        .await
        .expect_err("an unavailable API endpoint must fail");
        server.await.unwrap();

        let DomainError::UpstreamFailure(failure) = error else {
            panic!("HTTP 404 must carry the upstream endpoint: {error}");
        };
        let details = serde_json::to_value(failure).unwrap();
        assert_eq!(details["code"], "http.not_found");
        assert_eq!(details["endpoint"], endpoint);
        assert_eq!(
            details["provider_message"],
            "This API does not provide /responses"
        );
    }

    #[test]
    fn opencode_routes_by_wire_format() {
        assert_eq!(
            provider_transport_source(ChatCompletionSource::OpenCode, "/messages").unwrap(),
            ChatCompletionSource::Claude
        );
        assert_eq!(
            provider_transport_source(ChatCompletionSource::OpenCode, "/streamGenerateContent")
                .unwrap(),
            ChatCompletionSource::Makersuite
        );
        assert!(provider_transport_source(ChatCompletionSource::OpenCode, "/unknown").is_err());
    }

    #[test]
    fn apply_extra_headers_with_filter_skips_matching_headers() {
        let mut headers = HashMap::new();
        headers.insert("anthropic-beta".to_string(), "prompt-caching".to_string());
        headers.insert("x-custom".to_string(), "value".to_string());

        let request = Client::new().get("https://example.com");
        let request = HttpChatCompletionRepository::apply_extra_headers_with_filter(
            request,
            &headers,
            |key, _| key.eq_ignore_ascii_case("anthropic-beta"),
        );
        let request = request.build().expect("request should build");

        assert!(request.headers().get("anthropic-beta").is_none());
        assert_eq!(
            request
                .headers()
                .get("x-custom")
                .and_then(|value| value.to_str().ok()),
            Some("value")
        );
    }

    #[test]
    fn apply_openai_auth_prefers_explicit_authorization_header() {
        let config = ChatCompletionApiConfig {
            base_url: "https://example.com/v1".to_string(),
            user_configured_endpoint: false,
            api_key: "saved-secret".to_string(),
            authorization_header: Some("Bearer override".to_string()),
            vertexai_service_account_json: None,
            extra_headers: HashMap::new(),
            additional_headers: HashMap::new(),
            anthropic_beta_header_mode:
                tt_ports::repositories::chat_completion_repository::AnthropicBetaHeaderMode::None,
            aws_bedrock_custom_response_path: None,
            aws_bedrock_custom_stream_path: None,
        };

        let request = Client::new().get("https://example.com");
        let request = HttpChatCompletionRepository::apply_openai_auth(request, &config);
        let request = request.build().expect("request should build");

        let values = request
            .headers()
            .get_all(AUTHORIZATION)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .collect::<Vec<_>>();

        assert_eq!(values, vec!["Bearer override"]);
    }

    #[test]
    fn additional_headers_replace_existing_header_values() {
        let config = ChatCompletionApiConfig {
            base_url: "https://example.com/v1".to_string(),
            user_configured_endpoint: false,
            api_key: "saved-secret".to_string(),
            authorization_header: None,
            vertexai_service_account_json: None,
            extra_headers: HashMap::new(),
            additional_headers: HashMap::from([(
                "Authorization".to_string(),
                "Bearer final".to_string(),
            )]),
            anthropic_beta_header_mode:
                tt_ports::repositories::chat_completion_repository::AnthropicBetaHeaderMode::None,
            aws_bedrock_custom_response_path: None,
            aws_bedrock_custom_stream_path: None,
        };

        let request = Client::new().get("https://example.com");
        let request = HttpChatCompletionRepository::apply_openai_auth(request, &config);
        let request = HttpChatCompletionRepository::apply_additional_headers(request, &config);
        let request = request.build().expect("request should build");

        let values = request
            .headers()
            .get_all(AUTHORIZATION)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .collect::<Vec<_>>();

        assert_eq!(values, vec!["Bearer final"]);
    }

    #[test]
    fn error_status_classification_preserves_recovery_semantics() {
        for (status, body, overflow) in [
            (
                400,
                "prompt is too long: 213462 tokens > 200000 maximum",
                true,
            ),
            (
                400,
                "input length and `max_tokens` exceed context limit: 190000 + 32768 > 200000",
                true,
            ),
            (
                400,
                "Your input exceeds the context window of this model",
                true,
            ),
            (
                400,
                "This model's maximum context length is 131072 tokens. However, you requested 140000 tokens",
                true,
            ),
            (
                400,
                "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
                true,
            ),
            (
                400,
                r#"{"error":{"code":"context_length_exceeded","message":"invalid request"}}"#,
                true,
            ),
            (400, r#"{"message":"prompt is too long"}"#, true),
            (413, "<html>Request Entity Too Large</html>", true),
            (
                400,
                "Request payload size exceeds the limit: 20971520 bytes.",
                true,
            ),
            (400, "Invalid value for temperature", false),
            (400, "rate limit: too many tokens", false),
            (
                429,
                "ThrottlingException: Too many tokens, please wait before trying again.",
                false,
            ),
            (502, "upstream unavailable", false),
        ] {
            let error = HttpChatCompletionRepository::map_error_status(
                "Provider",
                reqwest::StatusCode::from_u16(status).unwrap(),
                body,
                "Generation request failed",
                None,
            );
            assert_eq!(
                matches!(&error, DomainError::InvalidData(message) if message.starts_with("model.context_overflow:")),
                overflow,
                "{status}: {body}: {error}"
            );
            match status {
                429 => assert!(matches!(error, DomainError::RateLimited { .. })),
                502 => assert!(matches!(error, DomainError::Transient(_))),
                _ => assert!(matches!(error, DomainError::InvalidData(_))),
            }
        }
    }

    #[test]
    fn forward_sse_events_extracts_data_payloads() {
        let mut events = Vec::<Vec<u8>>::new();
        let mut buffer =
            b"event: message\r\ndata: {\"chunk\":1}\n\n: ping\ndata: [DONE]\n\n".to_vec();

        let mut on_event = |event: &[u8]| {
            events.push(event.to_vec());
            Ok(())
        };
        let mut accumulator = super::SseEventAccumulator::default();
        let result = HttpChatCompletionRepository::forward_sse_events(
            &mut buffer,
            &mut accumulator,
            &mut on_event,
        );
        assert!(result.is_ok());

        assert_eq!(events, [b"{\"chunk\":1}".to_vec(), b"[DONE]".to_vec()]);
        assert!(buffer.is_empty());
    }

    #[test]
    fn forward_sse_events_keeps_partial_line_in_buffer() {
        let mut events = Vec::<Vec<u8>>::new();
        let mut buffer = b"data: {\"chunk\":1}".to_vec();

        let mut on_event = |event: &[u8]| {
            events.push(event.to_vec());
            Ok(())
        };
        let mut accumulator = super::SseEventAccumulator::default();
        let result = HttpChatCompletionRepository::forward_sse_events(
            &mut buffer,
            &mut accumulator,
            &mut on_event,
        );
        assert!(result.is_ok());
        assert!(events.is_empty());
        assert_eq!(buffer, b"data: {\"chunk\":1}".to_vec());
    }

    #[test]
    fn forward_sse_events_combines_multiline_data_fields() {
        let mut events = Vec::<Vec<u8>>::new();
        let mut buffer = b"data: first\ndata: second\n\n".to_vec();

        let mut on_event = |event: &[u8]| {
            events.push(event.to_vec());
            Ok(())
        };
        let mut accumulator = super::SseEventAccumulator::default();
        HttpChatCompletionRepository::forward_sse_events(
            &mut buffer,
            &mut accumulator,
            &mut on_event,
        )
        .unwrap();

        assert_eq!(events, [b"first\nsecond".to_vec()]);
        assert!(buffer.is_empty());
    }

    #[test]
    fn forward_sse_events_can_flush_pending_event_at_end_of_stream() {
        let mut events = Vec::<Vec<u8>>::new();
        let mut buffer = b"data: tail\n".to_vec();

        let mut on_event = |event: &[u8]| {
            events.push(event.to_vec());
            Ok(())
        };
        let mut accumulator = super::SseEventAccumulator::default();
        HttpChatCompletionRepository::forward_sse_events(
            &mut buffer,
            &mut accumulator,
            &mut on_event,
        )
        .unwrap();

        accumulator.finish(&mut on_event).unwrap();

        assert_eq!(events, [b"tail".to_vec()]);
    }
}

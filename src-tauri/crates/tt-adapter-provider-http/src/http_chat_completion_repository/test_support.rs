use std::sync::{Arc, Mutex};

use serde_json::{Map, Value};

#[derive(Default, Clone)]
pub(super) struct CaptureDiagnostics {
    pub(super) events: Arc<Mutex<Vec<DiagnosticEvent>>>,
}

pub(super) struct DiagnosticEvent {
    pub(super) level: tracing::Level,
    pub(super) fields: Map<String, Value>,
}

#[derive(Default)]
struct DiagnosticFields(Map<String, Value>);

impl tracing::field::Visit for DiagnosticFields {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.0
            .insert(field.name().to_owned(), format!("{value:?}").into());
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        self.0.insert(field.name().to_owned(), value.into());
    }

    fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
        self.0.insert(field.name().to_owned(), value.into());
    }
}

impl tracing::Subscriber for CaptureDiagnostics {
    fn enabled(&self, metadata: &tracing::Metadata<'_>) -> bool {
        metadata
            .target()
            .starts_with("tt_adapter_provider_http::http_chat_completion_repository")
            && (*metadata.level() == tracing::Level::WARN
                || *metadata.level() == tracing::Level::ERROR)
    }

    fn new_span(&self, _attributes: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }

    fn record(&self, _span: &tracing::span::Id, _values: &tracing::span::Record<'_>) {}

    fn record_follows_from(&self, _span: &tracing::span::Id, _follows: &tracing::span::Id) {}

    fn event(&self, event: &tracing::Event<'_>) {
        let mut fields = DiagnosticFields::default();
        event.record(&mut fields);
        self.events.lock().unwrap().push(DiagnosticEvent {
            level: *event.metadata().level(),
            fields: fields.0,
        });
    }

    fn enter(&self, _span: &tracing::span::Id) {}

    fn exit(&self, _span: &tracing::span::Id) {}
}

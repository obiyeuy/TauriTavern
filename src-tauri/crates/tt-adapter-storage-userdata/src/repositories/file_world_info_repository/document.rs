use std::borrow::Cow;
use std::collections::HashMap;

use serde_json::value::RawValue;
use tt_domain::errors::DomainError;
use tt_domain::models::character_book::character_book_to_world_info;

/// A validated document borrowing its original representation.
pub(super) struct Document<'a> {
    bytes: Cow<'a, [u8]>,
}

impl<'a> Document<'a> {
    pub(super) fn parse(bytes: &'a [u8]) -> Result<Self, DomainError> {
        let text = std::str::from_utf8(bytes).map_err(|error| {
            DomainError::InvalidData(format!("Invalid world info UTF-8: {error}"))
        })?;
        let fields: HashMap<String, &RawValue> = serde_json::from_str(text).map_err(json_error)?;
        let entries = fields.get("entries").ok_or_else(invalid_document)?;
        let bytes = match entries.get().as_bytes().first() {
            Some(b'{') => Cow::Borrowed(bytes),
            Some(b'[') => {
                let book = serde_json::from_str(text).map_err(json_error)?;
                let world_info = character_book_to_world_info(&book)?;
                Cow::Owned(serde_json::to_vec(&world_info).map_err(json_error)?)
            }
            _ => {
                return Err(DomainError::InvalidData(
                    "World info entries must be an object or a character book array".into(),
                ));
            }
        };
        Ok(Self { bytes })
    }

    pub(super) fn bytes(&self) -> &[u8] {
        self.bytes.as_ref()
    }
}

/// Reads normalize legacy book arrays without rewriting the user's original file.
pub(super) fn normalize(bytes: Vec<u8>) -> Result<Vec<u8>, DomainError> {
    match Document::parse(&bytes)?.bytes {
        Cow::Borrowed(_) => Ok(bytes),
        Cow::Owned(converted) => Ok(converted),
    }
}

pub(super) fn replacement(bytes: &[u8]) -> Result<(String, Document<'_>), DomainError> {
    // JSON object semantics: the last occurrence of each field wins, even if an
    // earlier name or data value had the wrong type. Opaque values stay borrowed.
    let fields: HashMap<String, &RawValue> = serde_json::from_slice(bytes).map_err(json_error)?;
    let name = fields
        .get("name")
        .and_then(|value| serde_json::from_str::<String>(value.get()).ok())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| DomainError::InvalidData("World file must have a name".into()))?;
    let data = fields.get("data").ok_or_else(invalid_document)?;
    Ok((name, Document::parse(data.get().as_bytes())?))
}

fn invalid_document() -> DomainError {
    DomainError::InvalidData("World info must be an object containing entries".into())
}

fn json_error(error: serde_json::Error) -> DomainError {
    DomainError::InvalidData(format!("Invalid world info JSON: {error}"))
}

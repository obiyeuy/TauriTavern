use std::sync::Arc;

use async_trait::async_trait;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use tt_domain::errors::DomainError;
use tt_domain::models::update::{ReleaseInfo, UpdateChannel};
use tt_ports::repositories::update_repository::UpdateRepository;

use super::classify_github_rate_limit;
use crate::{HttpClientPool, HttpClientProfile};

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    prerelease: bool,
    published_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubCommit {
    sha: String,
}

pub struct GitHubUpdateRepository {
    http_clients: Arc<HttpClientPool>,
    repository_api_url: String,
}

impl GitHubUpdateRepository {
    pub fn new(http_clients: Arc<HttpClientPool>, repository_api_url: &str) -> Self {
        Self {
            http_clients,
            repository_api_url: repository_api_url.trim_end_matches('/').to_string(),
        }
    }

    async fn get_json<T: DeserializeOwned>(&self, url: &str) -> Result<T, DomainError> {
        let client = self.http_clients.client(HttpClientProfile::Default)?;
        let response = client
            .get(url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|error| {
                DomainError::InternalError(format!("GitHub API request to {url} failed: {error}"))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.map_err(|error| {
                DomainError::InternalError(format!(
                    "Failed to read GitHub API HTTP {status} response from {url}: {error}"
                ))
            })?;
            if let Some(domain_error) = classify_github_rate_limit(status, &body) {
                return Err(domain_error);
            }

            let snippet = body.trim();
            let suffix = if snippet.is_empty() {
                String::new()
            } else {
                format!(" ({snippet})")
            };
            let hint = if status == reqwest::StatusCode::NOT_FOUND {
                " The updater reads public GitHub releases without authentication. Check the repository visibility and that this channel has a published release and tag."
            } else {
                ""
            };

            return Err(DomainError::InternalError(format!(
                "GitHub API error at {url}: HTTP {status}{suffix}.{hint}"
            )));
        }

        response.json().await.map_err(|error| {
            DomainError::InternalError(format!(
                "Failed to parse GitHub response from {url}: {error}"
            ))
        })
    }
}

#[async_trait]
impl UpdateRepository for GitHubUpdateRepository {
    async fn get_release(&self, channel: UpdateChannel) -> Result<ReleaseInfo, DomainError> {
        let release_path = match channel {
            UpdateChannel::Stable => "releases/latest",
            UpdateChannel::Canary => "releases/tags/Canary",
        };
        let response: GitHubRelease = self
            .get_json(&format!("{}/{release_path}", self.repository_api_url))
            .await?;

        match channel {
            UpdateChannel::Stable if response.prerelease => {
                return Err(DomainError::InvalidData(
                    "Stable update endpoint returned a prerelease".to_string(),
                ));
            }
            UpdateChannel::Canary if !response.prerelease => {
                return Err(DomainError::InvalidData(
                    "Canary update endpoint returned a stable release".to_string(),
                ));
            }
            _ => {}
        }

        let version =
            (channel == UpdateChannel::Stable).then(|| parse_version_from_tag(&response.tag_name));
        let source_revision = if channel == UpdateChannel::Canary {
            Some(
                self.get_json::<GitHubCommit>(&format!(
                    "{}/commits/Canary",
                    self.repository_api_url
                ))
                .await?
                .sha,
            )
        } else {
            None
        };

        Ok(ReleaseInfo {
            tag_name: response.tag_name,
            version,
            source_revision,
            name: response.name.unwrap_or_default(),
            body: response.body.unwrap_or_default(),
            html_url: response.html_url,
            prerelease: response.prerelease,
            published_at: response.published_at.unwrap_or_default(),
        })
    }
}

fn parse_version_from_tag(tag: &str) -> String {
    let tag = tag.trim();
    let Some(start) = tag.find(|c: char| c.is_ascii_digit()) else {
        return tag.to_string();
    };

    let candidate = &tag[start..];
    let end = candidate
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(candidate.len());
    candidate[..end].to_string()
}

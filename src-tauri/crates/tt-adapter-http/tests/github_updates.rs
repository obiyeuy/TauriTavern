use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tt_adapter_http::{GitHubUpdateRepository, HttpClientPool};
use tt_domain::models::update::UpdateChannel;
use tt_ports::repositories::update_repository::UpdateRepository;

struct GitHubServer {
    repository_url: String,
    task: JoinHandle<Vec<String>>,
}

impl GitHubServer {
    async fn start(responses: Vec<(u16, String)>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let repository_url = format!(
            "http://{}/repos/personal-owner/PersonalTavern",
            listener.local_addr().unwrap()
        );
        let task = tokio::spawn(async move {
            let mut requests = Vec::new();
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    let byte = stream.read_u8().await.unwrap();
                    request.push(byte);
                    assert!(request.len() < 8192, "request headers exceed test limit");
                }
                requests.push(String::from_utf8(request).unwrap());
                let response = format!(
                    "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).await.unwrap();
            }
            requests
        });
        Self {
            repository_url,
            task,
        }
    }

    fn repository(&self) -> GitHubUpdateRepository {
        GitHubUpdateRepository::new(
            Arc::new(HttpClientPool::new("TauriTavern/test")),
            &self.repository_url,
        )
    }

    async fn requests(&mut self) -> Vec<String> {
        timeout(Duration::from_secs(5), &mut self.task)
            .await
            .expect("update requests did not reach the configured repository")
            .unwrap()
    }
}

impl Drop for GitHubServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn release(tag: &str, prerelease: bool) -> String {
    json!({
        "tag_name": tag,
        "name": "Personal Android release",
        "body": "Connection and settings improvements",
        "html_url": "https://github.com/personal-owner/PersonalTavern/releases/tag/current",
        "prerelease": prerelease,
        "published_at": "2026-11-26T12:00:00Z"
    })
    .to_string()
}

#[tokio::test]
async fn stable_reads_the_configured_repository_without_credentials() {
    let mut server =
        GitHubServer::start(vec![(200, release("mobile-auto-v2.4.0-next-3.0.0", false))]).await;
    let repository = server.repository();

    let result = timeout(
        Duration::from_secs(5),
        repository.get_release(UpdateChannel::Stable),
    )
    .await
    .unwrap()
    .unwrap();

    assert_eq!(result.version.as_deref(), Some("2.4.0"));
    assert_eq!(result.source_revision, None);
    assert_eq!(result.name, "Personal Android release");
    assert_eq!(result.body, "Connection and settings improvements");
    assert_eq!(
        result.html_url,
        "https://github.com/personal-owner/PersonalTavern/releases/tag/current"
    );
    let requests = server.requests().await;
    assert_eq!(requests.len(), 1);
    assert!(
        requests[0]
            .starts_with("GET /repos/personal-owner/PersonalTavern/releases/latest HTTP/1.1\r\n")
    );
    let headers = requests[0].to_ascii_lowercase();
    assert!(headers.contains("accept: application/vnd.github+json\r\n"));
    assert!(!headers.contains("authorization:"));
}

#[tokio::test]
async fn canary_reads_release_and_revision_from_the_same_repository() {
    let mut server = GitHubServer::start(vec![
        (200, release("Canary", true)),
        (
            200,
            r#"{"sha":"44b126db7e23490330ef4a8ea622d36c70bc831c"}"#.into(),
        ),
    ])
    .await;
    let repository = server.repository();

    let result = timeout(
        Duration::from_secs(5),
        repository.get_release(UpdateChannel::Canary),
    )
    .await
    .unwrap()
    .unwrap();

    assert_eq!(result.version, None);
    assert_eq!(
        result.source_revision.as_deref(),
        Some("44b126db7e23490330ef4a8ea622d36c70bc831c")
    );
    assert!(result.prerelease);
    let requests = server.requests().await;
    assert_eq!(requests.len(), 2);
    assert!(
        requests[0].starts_with(
            "GET /repos/personal-owner/PersonalTavern/releases/tags/Canary HTTP/1.1\r\n"
        )
    );
    assert!(
        requests[1]
            .starts_with("GET /repos/personal-owner/PersonalTavern/commits/Canary HTTP/1.1\r\n")
    );
}

#[tokio::test]
async fn missing_release_is_an_error_with_repository_and_access_context() {
    let mut server = GitHubServer::start(vec![(
        404,
        r#"{"message":"Not Found","documentation_url":"https://docs.github.com/rest/releases"}"#
            .into(),
    )])
    .await;
    let repository = server.repository();

    let failure = timeout(
        Duration::from_secs(5),
        repository.get_release(UpdateChannel::Stable),
    )
    .await
    .unwrap()
    .unwrap_err()
    .to_string();

    assert!(failure.contains("404"), "{failure}");
    assert!(
        failure.contains("/repos/personal-owner/PersonalTavern/releases/latest"),
        "{failure}"
    );
    assert!(failure.contains("public"), "{failure}");
    assert!(failure.contains("Not Found"), "{failure}");
    assert_eq!(server.requests().await.len(), 1);
}

#[tokio::test]
async fn missing_canary_revision_propagates_the_commit_endpoint_error() {
    let mut server = GitHubServer::start(vec![
        (200, release("Canary", true)),
        (404, r#"{"message":"Not Found"}"#.into()),
    ])
    .await;
    let repository = server.repository();

    let failure = timeout(
        Duration::from_secs(5),
        repository.get_release(UpdateChannel::Canary),
    )
    .await
    .unwrap()
    .unwrap_err()
    .to_string();

    assert!(failure.contains("404"), "{failure}");
    assert!(
        failure.contains("/repos/personal-owner/PersonalTavern/commits/Canary"),
        "{failure}"
    );
    assert_eq!(server.requests().await.len(), 2);
}

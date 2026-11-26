use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;
use tokio::fs;
use tokio::sync::Mutex;

use crate::file_system::{read_json_file, write_json_file};
use tt_domain::errors::DomainError;
use tt_domain::models::secret::{SecretEntry, SecretKeys, Secrets};
use tt_ports::repositories::secret_repository::SecretRepository;

pub struct FileSecretRepository {
    secrets_file: PathBuf,
    // Owns the complete read-modify-publish transaction as well as the cache.
    cache: Mutex<Option<Secrets>>,
}

impl FileSecretRepository {
    pub fn new(secrets_file: PathBuf) -> Self {
        tracing::debug!(
            "Secret repository initialized with secrets file: {:?}",
            secrets_file
        );

        Self {
            secrets_file,
            cache: Mutex::new(None),
        }
    }

    async fn ensure_file_exists(&self) -> Result<(), DomainError> {
        if !self.secrets_file.exists() {
            tracing::info!("Creating secrets file: {:?}", self.secrets_file);

            // 确保父目录存在
            if let Some(parent) = self.secrets_file.parent()
                && !parent.exists()
            {
                fs::create_dir_all(parent).await.map_err(|e| {
                    tracing::error!("Failed to create parent directory for secrets file: {}", e);
                    DomainError::InternalError(format!("Failed to create directory: {}", e))
                })?;
            }

            // 创建空的secrets文件
            let empty_secrets = Secrets::new();
            write_json_file(&self.secrets_file, &empty_secrets).await?;
        }

        Ok(())
    }

    async fn load_locked<'a>(
        &self,
        cache: &'a mut Option<Secrets>,
    ) -> Result<&'a mut Secrets, DomainError> {
        if cache.is_none() {
            self.ensure_file_exists().await?;
            let raw = read_json_file::<Value>(&self.secrets_file).await?;
            let (secrets, migrated) = Self::deserialize_compat(raw);
            if migrated {
                self.write_file(&secrets).await?;
            }
            *cache = Some(secrets);
        }

        Ok(cache.as_mut().expect("secret cache initialized under lock"))
    }

    async fn write_file(&self, secrets: &Secrets) -> Result<(), DomainError> {
        self.ensure_file_exists().await?;
        write_json_file(&self.secrets_file, secrets).await
    }
}

#[async_trait]
impl SecretRepository for FileSecretRepository {
    async fn save(&self, secrets: &Secrets) -> Result<(), DomainError> {
        let mut cache = self.cache.lock().await;
        self.write_file(secrets).await?;
        *cache = Some(secrets.clone());
        Ok(())
    }

    async fn load(&self) -> Result<Secrets, DomainError> {
        let mut cache = self.cache.lock().await;
        Ok(self.load_locked(&mut cache).await?.clone())
    }

    async fn clear_cache(&self) -> Result<(), DomainError> {
        let mut cache = self.cache.lock().await;
        *cache = None;
        Ok(())
    }

    async fn write_secret(
        &self,
        key: &str,
        value: &str,
        label: &str,
    ) -> Result<String, DomainError> {
        let mut cache = self.cache.lock().await;
        let mut secrets = self.load_locked(&mut cache).await?.clone();
        let id = secrets.write_secret(key.to_string(), value.to_string(), label.to_string());
        self.write_file(&secrets).await?;
        *cache = Some(secrets);
        Ok(id)
    }

    async fn read_secret(
        &self,
        key: &str,
        id: Option<&str>,
    ) -> Result<Option<String>, DomainError> {
        let mut cache = self.cache.lock().await;
        Ok(self.load_locked(&mut cache).await?.read_secret(key, id))
    }

    async fn delete_secret(&self, key: &str, id: Option<&str>) -> Result<(), DomainError> {
        let mut cache = self.cache.lock().await;
        let mut secrets = self.load_locked(&mut cache).await?.clone();
        if secrets.delete_secret(key, id) {
            self.write_file(&secrets).await?;
            *cache = Some(secrets);
        }
        Ok(())
    }

    async fn rotate_secret(&self, key: &str, id: &str) -> Result<(), DomainError> {
        let mut cache = self.cache.lock().await;
        let mut secrets = self.load_locked(&mut cache).await?.clone();
        if secrets.rotate_secret(key, id) {
            self.write_file(&secrets).await?;
            *cache = Some(secrets);
        }
        Ok(())
    }

    async fn rename_secret(&self, key: &str, id: &str, label: &str) -> Result<(), DomainError> {
        let mut cache = self.cache.lock().await;
        let mut secrets = self.load_locked(&mut cache).await?.clone();
        if secrets.rename_secret(key, id, label.to_string()) {
            self.write_file(&secrets).await?;
            *cache = Some(secrets);
        }
        Ok(())
    }
}

impl FileSecretRepository {
    fn deserialize_compat(raw: Value) -> (Secrets, bool) {
        let mut secrets = Secrets::new();
        let mut migrated = false;

        let Value::Object(entries) = raw else {
            return (secrets, migrated);
        };

        for (key, value) in entries {
            if key == SecretKeys::MIGRATED {
                continue;
            }

            match value {
                Value::Array(array) => {
                    let mut normalized = Vec::new();
                    for item in array {
                        if let Ok(entry) = serde_json::from_value::<SecretEntry>(item) {
                            normalized.push(entry);
                        }
                    }

                    if !normalized.is_empty() {
                        Secrets::normalize_entries(&mut normalized);
                        secrets.secrets.insert(key, normalized);
                    }
                }
                Value::String(legacy) if !legacy.trim().is_empty() => {
                    secrets.write_secret(key.clone(), legacy, key);
                    migrated = true;
                }
                _ => {}
            }
        }

        (secrets, migrated)
    }
}

#[cfg(test)]
mod tests {
    use super::FileSecretRepository;
    use std::path::PathBuf;
    use tt_domain::errors::DomainError;
    use tt_ports::repositories::secret_repository::SecretRepository;

    struct TempDirGuard(PathBuf);

    impl TempDirGuard {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "tauritavern-secret-repository-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn concurrent_mutations_preserve_all_acknowledged_changes_on_disk() {
        let directory = TempDirGuard::new();
        let path = directory.0.join("secrets.json");
        let repository = FileSecretRepository::new(path.clone());
        let first = repository
            .write_secret("provider-a", "FIRST", "First")
            .await
            .unwrap();
        repository
            .write_secret("provider-a", "SECOND", "Second")
            .await
            .unwrap();
        let renamed = repository
            .write_secret("provider-b", "KEPT", "Before")
            .await
            .unwrap();
        let deleted = repository
            .write_secret("provider-c", "REMOVED", "Remove")
            .await
            .unwrap();

        let (write, rename, rotate, delete) = tokio::join!(
            repository.write_secret("provider-d", "NEW", "New"),
            repository.rename_secret("provider-b", &renamed, "Renamed"),
            repository.rotate_secret("provider-a", &first),
            repository.delete_secret("provider-c", Some(&deleted)),
        );
        write.unwrap();
        rename.unwrap();
        rotate.unwrap();
        delete.unwrap();

        let reopened = FileSecretRepository::new(path);
        let stored = reopened.load().await.unwrap();
        assert_eq!(
            stored.read_secret("provider-a", None).as_deref(),
            Some("FIRST")
        );
        assert_eq!(stored.secrets["provider-b"][0].label, "Renamed");
        assert!(stored.read_secret("provider-c", None).is_none());
        assert_eq!(
            stored.read_secret("provider-d", None).as_deref(),
            Some("NEW")
        );
    }

    #[tokio::test]
    async fn invalid_stored_json_rejects_a_mutation_without_overwriting_the_file() {
        let directory = TempDirGuard::new();
        let path = directory.0.join("secrets.json");
        let original = b"{invalid stored JSON";
        tokio::fs::write(&path, original).await.unwrap();
        let repository = FileSecretRepository::new(path.clone());

        let result = repository
            .write_secret("provider-a", "TEST-ONLY", "Test")
            .await;

        assert!(matches!(result, Err(DomainError::InvalidData(_))));
        assert_eq!(tokio::fs::read(path).await.unwrap(), original);
    }
}

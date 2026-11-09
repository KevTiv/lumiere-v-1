//! Prepare, copy and verify managed document storage without activating it.

use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use api_server::document_blob_migration::{
    copy_verified, plan_local, verify, MigrationManifest, MigrationReference,
};
use api_server::document_blob_store::DocumentBlobStoreConfig;
use tokio::io::AsyncWriteExt;

const USAGE: &str = "document-blob-migrate plan SOURCE_DIR REFERENCES_JSON MANIFEST_JSON\n\
document-blob-migrate copy SOURCE_DIR MANIFEST_JSON --writers-fenced [--local-target DIR]\n\
document-blob-migrate verify SOURCE_DIR MANIFEST_JSON [--local-target DIR]\n\
document-blob-migrate recover TARGET_DIR MANIFEST_JSON --writers-fenced\n\n\
S3 uses LUMIERE_DOCUMENT_S3_* settings; credentials are never stored in the manifest.\n\
Copy and recover require an operator-established fence over every blob writer.\n\
Recover copies only reviewed manifest entries. Reconcile post-cutover writes first.\n\
No command changes application configuration or removes source objects.";

#[derive(Debug, PartialEq, Eq)]
enum Mode {
    Plan {
        source: PathBuf,
        references: PathBuf,
        manifest: PathBuf,
    },
    Transfer {
        source: PathBuf,
        manifest: PathBuf,
        target: Option<PathBuf>,
        write: bool,
    },
    Recover {
        target: PathBuf,
        manifest: PathBuf,
    },
    Help,
}

fn mode(args: &[String]) -> Result<Mode> {
    match args {
        [] => Ok(Mode::Help),
        [help] if matches!(help.as_str(), "--help" | "-h") => Ok(Mode::Help),
        [command, source, references, manifest] if command == "plan" => Ok(Mode::Plan {
            source: source.into(),
            references: references.into(),
            manifest: manifest.into(),
        }),
        [command, target, manifest, fence]
            if command == "recover" && fence == "--writers-fenced" =>
        {
            Ok(Mode::Recover {
                target: target.into(),
                manifest: manifest.into(),
            })
        }
        [command, source, manifest, rest @ ..] if matches!(command.as_str(), "copy" | "verify") => {
            let write = command == "copy";
            let rest = if write {
                match rest.split_first() {
                    Some((fence, remaining)) if fence == "--writers-fenced" => remaining,
                    _ => bail!("copy requires --writers-fenced after fencing all writers"),
                }
            } else {
                rest
            };
            let target = match rest {
                [] => None,
                [flag, target] if flag == "--local-target" => Some(target.into()),
                _ => bail!("unknown migration arguments; use --help"),
            };
            Ok(Mode::Transfer {
                source: source.into(),
                manifest: manifest.into(),
                target,
                write,
            })
        }
        _ => bail!("unknown migration arguments; use --help"),
    }
}

async fn read_json<T: serde::de::DeserializeOwned>(path: &PathBuf) -> Result<T> {
    if tokio::fs::metadata(path).await?.len() > 64 * 1024 * 1024 {
        bail!("migration inventory exceeds the 64 MiB limit");
    }
    serde_json::from_slice(&tokio::fs::read(path).await?).context("invalid migration inventory")
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    match mode(&std::env::args().skip(1).collect::<Vec<_>>())? {
        Mode::Help => println!("{USAGE}"),
        Mode::Plan {
            source,
            references,
            manifest,
        } => {
            let source = tokio::fs::canonicalize(source).await?;
            let parent = manifest
                .parent()
                .filter(|path| !path.as_os_str().is_empty())
                .unwrap_or_else(|| std::path::Path::new("."));
            let manifest = tokio::fs::canonicalize(parent).await?.join(
                manifest
                    .file_name()
                    .context("manifest must name a new file")?,
            );
            if manifest.starts_with(&source) {
                bail!("save the migration manifest outside the source object directory");
            }
            let references: Vec<MigrationReference> = read_json(&references).await?;
            let planned = plan_local(source, references).await?;
            let mut file = tokio::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(manifest)
                .await?;
            file.write_all(&serde_json::to_vec_pretty(&planned)?)
                .await?;
            file.sync_all().await?;
            println!(
                "Prepared {} objects and {} source references for review.",
                planned.objects.len(),
                planned.references.len()
            );
        }
        Mode::Transfer {
            source,
            manifest,
            target,
            write,
        } => {
            let manifest: MigrationManifest = read_json(&manifest).await?;
            let source = tokio::fs::canonicalize(source).await?;
            let destination = match target {
                Some(root) => {
                    if write {
                        tokio::fs::create_dir_all(&root).await?;
                    }
                    let root = tokio::fs::canonicalize(root).await?;
                    if root.starts_with(&source) || source.starts_with(&root) {
                        bail!("source and destination directories must not overlap");
                    }
                    DocumentBlobStoreConfig::Local { root }
                }
                None => api_server::config::document_migration_s3_from_env()?,
            };
            let source = DocumentBlobStoreConfig::Local { root: source };
            let report = if write {
                copy_verified(&manifest, &source, &destination).await?
            } else {
                verify(&manifest, &source).await?;
                verify(&manifest, &destination).await?
            };
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        Mode::Recover { target, manifest } => {
            let manifest: MigrationManifest = read_json(&manifest).await?;
            let source = api_server::config::document_migration_s3_from_env()?;
            tokio::fs::create_dir_all(&target).await?;
            let destination = DocumentBlobStoreConfig::Local {
                root: tokio::fs::canonicalize(target).await?,
            };
            let report = copy_verified(&manifest, &source, &destination).await?;
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_flags_cannot_enable_copy_or_recovery() {
        let parse = |args: &[&str]| mode(&args.iter().map(|arg| (*arg).into()).collect::<Vec<_>>());
        assert!(parse(&["copy", "source", "manifest"]).is_err());
        assert!(parse(&["recover", "target", "manifest"]).is_err());
        assert!(parse(&["verify", "source", "manifest", "--writers-fenced"]).is_err());
        assert!(matches!(
            parse(&["verify", "source", "manifest"]).unwrap(),
            Mode::Transfer { write: false, .. }
        ));
        assert!(matches!(
            parse(&["copy", "source", "manifest", "--writers-fenced"]).unwrap(),
            Mode::Transfer { write: true, .. }
        ));
    }
}
